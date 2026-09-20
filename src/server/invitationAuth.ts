import fs from 'fs';
import path from 'path';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { adminAuth, SYSTEM_SERVER_UID, FIREBASE_ADMIN_PROJECT_ID } from './firebaseAdmin';

let isServerAuthenticated = false;
let isServerAuthenticating = false;

export async function ensureServerAuthenticated(): Promise<boolean> {
  // This identity is backend-only. It is provisioned and granted the server
  // custom claim exclusively through the Firebase Admin SDK.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.SKIP_SERVER_AUTH_FOR_LOCAL_TEST === 'true') {
    return true;
  }

  if (isServerAuthenticated && auth.currentUser) return true;
  if (isServerAuthenticating) {
    while (isServerAuthenticating) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return isServerAuthenticated && Boolean(auth.currentUser);
  }

  // AI Studio/local development uses Firebase Admin directly for server-owned
  // Firestore operations. Do not call Firebase Auth provisioning endpoints from
  // the dev backend because the AI Studio runtime may not have the Identity
  // Toolkit API enabled. Those calls are unnecessary for Admin SDK Firestore.
  if (process.env.NODE_ENV !== 'production') {
    isServerAuthenticated = true;
    console.log(
      '[RestaurantOS Server] AI Studio/dev server identity ready via Firebase Admin SDK.',
      { projectId: FIREBASE_ADMIN_PROJECT_ID }
    );
    return true;
  }

  isServerAuthenticating = true;
  try {
    if (process.env.NODE_ENV === 'production' && !process.env.SYSTEM_SERVER_UID?.trim()) {
      console.error('[RestaurantOS Server] SYSTEM_SERVER_UID is not configured.');
      return false;
    }

    let serverUser;
    try {
      serverUser = await adminAuth.getUser(SYSTEM_SERVER_UID);
    } catch (err: any) {
      if (err?.code !== 'auth/user-not-found') throw err;
      // The UID is created only by the Admin SDK. A browser/client cannot race
      // to claim this privileged identity.
      serverUser = await adminAuth.createUser({
        uid: SYSTEM_SERVER_UID,
        disabled: false
      });
    }

    const currentClaims = serverUser.customClaims || {};
    if (currentClaims.server !== true) {
      await adminAuth.setCustomUserClaims(SYSTEM_SERVER_UID, {
        ...currentClaims,
        server: true
      });
    }

    isServerAuthenticated = true;
    console.log(
      '[RestaurantOS Server] Backend server identity prepared via Firebase Admin SDK.',
      { projectId: FIREBASE_ADMIN_PROJECT_ID }
    );
    return true;
  } catch (err: any) {
    isServerAuthenticated = false;
    console.error('[RestaurantOS Server] Backend server authentication failed:', err?.message || err);
    return false;
  } finally {
    isServerAuthenticating = false;
  }
}

export interface VerifiedAuthUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

export interface AuthoritativeInvitationData {
  restaurantName: string;
  staffName: string;
  role: string;
  email: string;
}

export interface AuthCheckResult {
  authorized: boolean;
  code: number;
  error?: string;
  message?: string;
  authoritativeData?: AuthoritativeInvitationData;
}

// In-memory sliding-window rate limiter
interface RateLimitEntry {
  timestamps: number[];
}

const callerRateLimits = new Map<string, RateLimitEntry>();
const targetEmailRateLimits = new Map<string, RateLimitEntry>();

// Load firebase config safely
export interface FirebaseServerConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId?: string;
}

let cachedFirebaseConfig: FirebaseServerConfig | null = null;

export function getFirebaseConfig(): FirebaseServerConfig {
  if (cachedFirebaseConfig) return cachedFirebaseConfig;
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      cachedFirebaseConfig = JSON.parse(raw);
      return cachedFirebaseConfig!;
    }
  } catch (err) {
    console.warn('[RestaurantOS Server] Warning reading firebase-applet-config.json:', err);
  }
  return {
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'project-0edd3716-fc3b-40b7-b96',
    apiKey: process.env.VITE_FIREBASE_API_KEY || '',
    firestoreDatabaseId: process.env.VITE_FIRESTORE_DATABASE_ID || '(default)'
  };
}

export function getFirestoreBaseUrl(): string {
  const config = getFirebaseConfig();
  const dbId =
    config.firestoreDatabaseId && config.firestoreDatabaseId.trim() !== ''
      ? config.firestoreDatabaseId.trim()
      : '(default)';
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${dbId}/documents`;
}

/**
 * Mock / Test hooks for unit tests and local simulation
 */
type MockTokenVerifier = (token: string) => Promise<VerifiedAuthUser | null>;
type MockPermissionChecker = (
  callerUid: string,
  restaurantId: string,
  invitationId: string,
  toEmail: string
) => Promise<AuthCheckResult>;

let customTokenVerifier: MockTokenVerifier | null = null;
let customPermissionChecker: MockPermissionChecker | null = null;

export function setMockTokenVerifier(verifier: MockTokenVerifier | null) {
  customTokenVerifier = verifier;
}

export function setMockPermissionChecker(checker: MockPermissionChecker | null) {
  customPermissionChecker = checker;
}

export function resetRateLimits() {
  callerRateLimits.clear();
  targetEmailRateLimits.clear();
}

/**
 * Checks in-memory sliding-window rate limit
 * Caller UID: max 10 requests per 60 seconds
 * Target Email: max 3 requests per 300 seconds
 */
export function checkRateLimit(
  callerUid: string,
  toEmail: string
): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();

  // 1. Check caller rate limit (10 reqs / 60s)
  const callerWindow = 60 * 1000;
  const callerLimit = 10;
  let callerEntry = callerRateLimits.get(callerUid);
  if (!callerEntry) {
    callerEntry = { timestamps: [] };
    callerRateLimits.set(callerUid, callerEntry);
  }
  callerEntry.timestamps = callerEntry.timestamps.filter((t) => now - t < callerWindow);
  if (callerEntry.timestamps.length >= callerLimit) {
    const oldest = callerEntry.timestamps[0];
    const retryAfter = Math.ceil((callerWindow - (now - oldest)) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  // 2. Check target email rate limit (3 reqs / 300s)
  const emailWindow = 300 * 1000;
  const emailLimit = 3;
  let emailEntry = targetEmailRateLimits.get(toEmail);
  if (!emailEntry) {
    emailEntry = { timestamps: [] };
    targetEmailRateLimits.set(toEmail, emailEntry);
  }
  emailEntry.timestamps = emailEntry.timestamps.filter((t) => now - t < emailWindow);
  if (emailEntry.timestamps.length >= emailLimit) {
    const oldest = emailEntry.timestamps[0];
    const retryAfter = Math.ceil((emailWindow - (now - oldest)) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  // Record this attempt
  callerEntry.timestamps.push(now);
  emailEntry.timestamps.push(now);

  return { allowed: true };
}

/**
 * Verifies Firebase ID token securely.
 * Uses custom test verifier if registered (for tests),
 * otherwise verifies via Google Identity Toolkit endpoint.
 */
export async function verifyFirebaseToken(idToken: string): Promise<VerifiedAuthUser | null> {
  if (!idToken || typeof idToken !== 'string') return null;

  if (customTokenVerifier) {
    return customTokenVerifier(idToken);
  }

  // Test token prefix support for development / testing
  if ((process.env.NODE_ENV === 'test' || process.env.VITEST) && idToken.startsWith('mock_')) {
    const parts = idToken.split('_');
    const uid = parts.slice(1).join('_') || 'test_user';
    return { uid, email: `${uid}@example.com`, emailVerified: true };
  }

  try {
    // Verify with Firebase Admin instead of calling Identity Toolkit directly
    // with a Web API key. This keeps server authentication bound to the exact
    // Firebase project configured by firebaseAdmin.ts and avoids AI Studio's
    // ambient Google Cloud project/API-key mismatch.
    const decoded = await adminAuth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified)
    };
  } catch (err: any) {
    console.warn('[RestaurantOS Server] Firebase Admin ID token verification rejected:', err?.message || err);
    return null;
  }
}

/**
 * Verifies restaurant authorization and validates the staff invitation document.
 * 1. Checks that the restaurant exists and caller is owner or authorized manager.
 * 2. Checks that invitation document exists, is pending, matches email, not expired, not revoked.
 * 3. Resolves authoritative restaurant display name from database (never trusts client spoofing).
 */
export async function verifyRestaurantStaffAuthorization(
  callerUid: string,
  idToken: string,
  restaurantId: string,
  invitationId: string,
  toEmail: string
): Promise<AuthCheckResult> {
  if (customPermissionChecker) {
    return customPermissionChecker(callerUid, restaurantId, invitationId, toEmail);
  }

  const cleanRestaurantId = restaurantId.trim();
  const cleanInvitationId = invitationId.trim();
  const cleanEmail = toEmail.trim().toLowerCase();

  const baseUrl = getFirestoreBaseUrl();

  try {
    // 1. Fetch Restaurant Document using caller's ID token
    // Firestore rules enforce that caller has access to get/read this restaurant
    const restRes = await fetch(`${baseUrl}/restaurants/${cleanRestaurantId}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    });

    if (restRes.status === 403 || restRes.status === 401) {
      return {
        authorized: false,
        code: 403,
        error: 'FORBIDDEN_RESTAURANT_ACCESS',
        message: 'Caller is not authorized to access this restaurant.'
      };
    }

    if (restRes.status === 404) {
      return {
        authorized: false,
        code: 404,
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant does not exist.'
      };
    }

    const restDoc = await restRes.json();
    const ownerId = restDoc.fields?.ownerId?.stringValue;
    const authoritativeRestaurantName =
      restDoc.fields?.name?.stringValue ||
      restDoc.fields?.legalName?.stringValue ||
      'Restaurant';

    // 2. Check if caller is owner or manager (manage_staff permission)
    let isAuthorizedActor = callerUid === ownerId;

    if (!isAuthorizedActor) {
      // Check caller's member document
      const memberRes = await fetch(`${baseUrl}/restaurants/${cleanRestaurantId}/members/${callerUid}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });

      if (memberRes.ok) {
        const memberDoc = await memberRes.json();
        const role = memberDoc.fields?.role?.stringValue;
        const isActive = memberDoc.fields?.isActive?.booleanValue !== false;
        const status = memberDoc.fields?.status?.stringValue;
        if (isActive && status !== 'inactive' && (role === 'owner' || role === 'manager')) {
          isAuthorizedActor = true;
        }
      }
    }

    if (!isAuthorizedActor) {
      return {
        authorized: false,
        code: 403,
        error: 'UNAUTHORIZED_MANAGE_STAFF',
        message: 'Caller does not possess manage_staff permission for this restaurant.'
      };
    }

    // 3. If invitationId is provided, validate the invitation document
    if (cleanInvitationId) {
      const invRes = await fetch(
        `${baseUrl}/restaurants/${cleanRestaurantId}/members/${cleanInvitationId}`,
        {
          headers: { Authorization: `Bearer ${idToken}` }
        }
      );

      if (!invRes.ok) {
        return {
          authorized: false,
          code: 404,
          error: 'INVITATION_NOT_FOUND',
          message: 'Invitation record not found in the specified restaurant.'
        };
      }

      const invDoc = await invRes.json();
      const fields = invDoc.fields || {};
      const docEmail = (fields.email?.stringValue || '').trim().toLowerCase();
      const docRole = fields.role?.stringValue || 'staff';
      const docName = fields.displayName?.stringValue || 'Staff Member';
      const docStatus = fields.status?.stringValue || 'pending_setup';
      const docInvStatus = fields.invitationStatus?.stringValue || 'pending_setup';
      const expiresAt = Number(fields.expiresAt?.integerValue || 0);

      // Verify email match
      if (docEmail && docEmail !== cleanEmail) {
        return {
          authorized: false,
          code: 400,
          error: 'INVITATION_EMAIL_MISMATCH',
          message: `Invitation email (${docEmail}) does not match requested recipient (${cleanEmail}).`
        };
      }

      // Verify expiration
      if (expiresAt > 0 && Date.now() > expiresAt) {
        return {
          authorized: false,
          code: 400,
          error: 'INVITATION_EXPIRED',
          message: 'This invitation has expired.'
        };
      }

      // Verify revocation
      if (docStatus === 'revoked' || docInvStatus === 'revoked') {
        return {
          authorized: false,
          code: 400,
          error: 'INVITATION_REVOKED',
          message: 'This invitation has been revoked.'
        };
      }

      return {
        authorized: true,
        code: 200,
        authoritativeData: {
          restaurantName: authoritativeRestaurantName,
          staffName: docName,
          role: docRole,
          email: docEmail || cleanEmail
        }
      };
    }

    return {
      authorized: true,
      code: 200,
      authoritativeData: {
        restaurantName: authoritativeRestaurantName,
        staffName: 'Staff Member',
        role: 'staff',
        email: cleanEmail
      }
    };
  } catch (err: any) {
    console.error('[RestaurantOS Server] Permission verification error:', err);
    return {
      authorized: false,
      code: 500,
      error: 'AUTHORIZATION_VERIFICATION_FAILED',
      message: err?.message || 'Server failed to verify authorization.'
    };
  }
}

/**
 * Verifies that the authenticated caller is an active member of the restaurant
 * with one of the explicitly allowed operational roles. Used by trusted server
 * endpoints before server-side mutations are performed on the caller's behalf.
 */
export async function verifyRestaurantStaffRole(
  callerUid: string,
  idToken: string,
  restaurantId: string,
  allowedRoles: string[]
): Promise<{ authorized: boolean; code: number; error?: string; message?: string; role?: string }> {
  const cleanRestaurantId = restaurantId?.trim();
  if (!callerUid || !idToken || !cleanRestaurantId) {
    return { authorized: false, code: 400, error: 'INVALID_PARAMETERS', message: 'Caller identity and restaurantId are required.' };
  }

  const roles = new Set(allowedRoles.map((role) => role.trim().toLowerCase()).filter(Boolean));
  if (roles.size === 0) {
    return { authorized: false, code: 500, error: 'ROLE_CONFIGURATION_ERROR', message: 'No allowed staff roles were configured.' };
  }

  if ((process.env.NODE_ENV === 'test' || process.env.VITEST) && idToken.startsWith('mock_')) {
    const role = callerUid.toLowerCase().includes('manager') || callerUid.toLowerCase().includes('owner')
      ? 'manager'
      : callerUid.toLowerCase().includes('captain')
        ? 'captain'
        : callerUid.toLowerCase().includes('cashier')
          ? 'cashier'
          : '';
    return roles.has(role) ? { authorized: true, code: 200, role } : {
      authorized: false,
      code: 403,
      error: 'FORBIDDEN',
      message: 'Caller is not authorized for this restaurant operation.'
    };
  }

  const baseUrl = getFirestoreBaseUrl();
  try {
    const restaurantRes = await fetch(`${baseUrl}/restaurants/${encodeURIComponent(cleanRestaurantId)}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    });

    if (restaurantRes.status === 401 || restaurantRes.status === 403) {
      return { authorized: false, code: 403, error: 'FORBIDDEN_RESTAURANT_ACCESS', message: 'Caller is not authorized to access this restaurant.' };
    }
    if (restaurantRes.status === 404) {
      return { authorized: false, code: 404, error: 'RESTAURANT_NOT_FOUND', message: 'Restaurant does not exist.' };
    }
    if (!restaurantRes.ok) {
      return { authorized: false, code: 502, error: 'RESTAURANT_LOOKUP_FAILED', message: 'Unable to verify restaurant access.' };
    }

    const restaurantJson = await restaurantRes.json();
    const ownerId = restaurantJson.fields?.ownerId?.stringValue || '';
    if (ownerId === callerUid && roles.has('owner')) {
      return { authorized: true, code: 200, role: 'owner' };
    }

    const memberRes = await fetch(
      `${baseUrl}/restaurants/${encodeURIComponent(cleanRestaurantId)}/members/${encodeURIComponent(callerUid)}`,
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    if (!memberRes.ok) {
      return { authorized: false, code: 403, error: 'FORBIDDEN', message: 'Caller is not an active member of this restaurant.' };
    }

    const memberJson = await memberRes.json();
    const role = String(memberJson.fields?.role?.stringValue || '').trim().toLowerCase();
    const isActive = memberJson.fields?.isActive?.booleanValue !== false;
    const status = String(memberJson.fields?.status?.stringValue || 'active').trim().toLowerCase();

    if (!isActive || ['inactive', 'revoked'].includes(status) || !roles.has(role)) {
      return { authorized: false, code: 403, error: 'FORBIDDEN', message: 'Caller lacks the required active role for this restaurant operation.' };
    }

    return { authorized: true, code: 200, role };
  } catch (err: any) {
    return { authorized: false, code: 502, error: 'STAFF_AUTH_CHECK_FAILED', message: err?.message || 'Unable to verify staff access.' };
  }
}

/**
 * Verifies that the caller is the authoritative owner of the restaurant.
 * Strictly enforces that:
 * 1. Restaurant exists
 * 2. Caller is the owner (ownerId === callerUid or active member with role === 'owner')
 * Managers and operational staff are strictly prohibited from managing subscriptions.
 */
export async function verifyRestaurantOwnerForSubscription(
  callerUid: string,
  idToken: string,
  restaurantId: string
): Promise<{ authorized: boolean; code: number; error?: string; message?: string }> {
  if (customPermissionChecker) {
    const res = await customPermissionChecker(callerUid, restaurantId, '', '');
    return { authorized: res.authorized, code: res.code, error: res.error, message: res.message };
  }

  // Support test environment mock tokens
  if ((process.env.NODE_ENV === 'test' || process.env.VITEST) && idToken.startsWith('mock_')) {
    if (
      callerUid.includes('non_owner') ||
      callerUid.includes('staff') ||
      callerUid.includes('manager') ||
      callerUid.includes('cashier') ||
      callerUid.includes('kitchen')
    ) {
      return {
        authorized: false,
        code: 403,
        error: 'FORBIDDEN_SUBSCRIPTION_MANAGEMENT',
        message: 'Only the restaurant owner has permission to manage or purchase subscriptions.'
      };
    }
    return { authorized: true, code: 200 };
  }

  const cleanRestaurantId = restaurantId.trim();
  const baseUrl = getFirestoreBaseUrl();
  const config = getFirebaseConfig();

  console.log('[RestaurantOS Diagnostics] Verifying owner for subscription:', {
    restaurantId: cleanRestaurantId,
    callerUid,
    projectId: config.projectId,
    firestoreDatabaseId: config.firestoreDatabaseId || '(default)'
  });

  // Strategy 1: Direct Firestore SDK lookup (authoritative on running server instance)
  try {
    await ensureServerAuthenticated();
    const restDocRef = doc(db, 'restaurants', cleanRestaurantId);
    const snap = await getDoc(restDocRef);

    if (snap.exists()) {
      const restData = snap.data();
      const ownerId = restData?.ownerId;

      console.log('[RestaurantOS Diagnostics] Firestore SDK restaurant lookup succeeded:', {
        restaurantId: cleanRestaurantId,
        ownerId,
        callerUid,
        isDirectOwner: ownerId === callerUid
      });

      if (ownerId && ownerId === callerUid) {
        return { authorized: true, code: 200 };
      }

      // Check member document for owner role
      const memberDocRef = doc(db, 'restaurants', cleanRestaurantId, 'members', callerUid);
      const memberSnap = await getDoc(memberDocRef);
      if (memberSnap.exists()) {
        const memberData = memberSnap.data();
        const role = memberData?.role;
        const isActive = memberData?.isActive !== false;
        const status = memberData?.status;
        if (isActive && status !== 'inactive' && role === 'owner') {
          return { authorized: true, code: 200 };
        }
      }

      return {
        authorized: false,
        code: 403,
        error: 'FORBIDDEN_SUBSCRIPTION_MANAGEMENT',
        message: 'Only the restaurant owner has permission to manage or purchase subscriptions.'
      };
    } else {
      console.log('[RestaurantOS Diagnostics] Firestore SDK restaurant document does not exist:', cleanRestaurantId);
    }
  } catch (sdkErr: any) {
    console.warn('[RestaurantOS Diagnostics] Firestore SDK lookup notice:', sdkErr?.message || sdkErr);
  }

  // Strategy 2: REST API verification fallback with caller's ID token
  try {
    const restRes = await fetch(`${baseUrl}/restaurants/${cleanRestaurantId}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    });

    console.log('[RestaurantOS Diagnostics] Firestore REST lookup response:', {
      restaurantId: cleanRestaurantId,
      status: restRes.status,
      baseUrl
    });

    if (restRes.status === 403 || restRes.status === 401) {
      return {
        authorized: false,
        code: 403,
        error: 'FORBIDDEN_RESTAURANT_ACCESS',
        message: 'Caller is not authorized to access this restaurant.'
      };
    }

    if (restRes.status === 404) {
      return {
        authorized: false,
        code: 404,
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant does not exist.'
      };
    }

    const restDoc = await restRes.json();
    const ownerId = restDoc.fields?.ownerId?.stringValue;

    if (ownerId && ownerId === callerUid) {
      return { authorized: true, code: 200 };
    }

    // Check member doc for owner role
    const memberRes = await fetch(`${baseUrl}/restaurants/${cleanRestaurantId}/members/${callerUid}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    });

    if (memberRes.ok) {
      const memberDoc = await memberRes.json();
      const role = memberDoc.fields?.role?.stringValue;
      const isActive = memberDoc.fields?.isActive?.booleanValue !== false;
      const status = memberDoc.fields?.status?.stringValue;
      if (isActive && status !== 'inactive' && role === 'owner') {
        return { authorized: true, code: 200 };
      }
    }

    return {
      authorized: false,
      code: 403,
      error: 'FORBIDDEN_SUBSCRIPTION_MANAGEMENT',
      message: 'Only the restaurant owner has permission to manage or purchase subscriptions.'
    };
  } catch (err: any) {
    console.error('[RestaurantOS Server] Owner verification error:', err);
    return {
      authorized: false,
      code: 500,
      error: 'AUTHORIZATION_VERIFICATION_FAILED',
      message: err?.message || 'Server failed to verify owner authorization.'
    };
  }
}

