import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { CustomerProfile, CustomerAddress } from '../types/customer';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';

/**
 * Maps raw Firebase Auth errors to clear, friendly customer-facing error messages.
 */
export function formatCustomerAuthError(error: unknown): string {
  if (!error) return 'An unexpected error occurred. Please try again.';
  const code = (error as any)?.code || '';
  const message = error instanceof Error ? error.message : String(error);

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled. You can continue as a guest or try again.';
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked by your browser. Please enable popups to sign in.';
    case 'auth/network-request-failed':
      return 'Network connection issue. Please check your internet connection and try again.';
    case 'auth/cancelled-popup-request':
      return 'Sign-in window closed. Please try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    default:
      if (message.toLowerCase().includes('network')) {
        return 'Network connection issue. Please try again.';
      }
      return 'Unable to sign in with Google. Please try again.';
  }
}

/**
 * Fetches the customer profile document from Firestore.
 * Tenant-safe: reads strictly from /customers/{customerId}.
 */
export async function getCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
  if (!customerId) return null;
  const customerRef = doc(db, 'customers', customerId);

  try {
    const snap = await getDoc(customerRef);
    if (!snap.exists()) {
      return null;
    }
    const data = snap.data();
    return {
      customerId: data.customerId || customerId,
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      photoURL: data.photoURL || null,
      authProvider: data.authProvider || 'google.com',
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      accountStatus: data.accountStatus === 'blocked' ? 'blocked' : 'active',
      blockedAt: data.blockedAt,
      blockedReason: data.blockedReason
    };
  } catch (err) {
    throw handleFirestoreError(err, OperationType.GET, `customers/${customerId}`);
  }
}

/**
 * Provisions or retrieves the customer profile for an authenticated Google user.
 * Guarantees that customerId strictly equals the Firebase Auth UID.
 */
export async function provisionCustomerProfile(firebaseUser: FirebaseUser): Promise<CustomerProfile> {
  const customerId = firebaseUser.uid;

  // A Firebase UID that already owns or staffs a restaurant must never be
  // silently converted into a customer identity. Restaurant ownership is
  // authoritative from the /users/{uid} profile pointer.
  const userRef = doc(db, 'users', customerId);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const userData = userSnap.data() as any;
    if (userData.restaurantId || userData.role === 'owner' || userData.role === 'manager' || userData.role === 'cashier' || userData.role === 'kitchen' || userData.role === 'captain' || userData.role === 'accountant') {
      throw new Error('This Google account is registered as a Restaurant account. Customer access is unavailable while the restaurant account exists.');
    }
  }

  const existing = await getCustomerProfile(customerId);

  if (existing) {
    if (existing.accountStatus === 'blocked') {
      throw new Error('Customer access is blocked because this Google account owns a Restaurant. Delete the Restaurant permanently to restore Customer access.');
    }

    // If photoURL was missing previously or has updated from Google, update it safely
    if (firebaseUser.photoURL && existing.photoURL !== firebaseUser.photoURL) {
      try {
        const customerRef = doc(db, 'customers', customerId);
        await setDoc(
          customerRef,
          {
            photoURL: firebaseUser.photoURL,
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        );
        existing.photoURL = firebaseUser.photoURL;
      } catch {
        // Non-critical, continue with existing profile
      }
    }
    return existing;
  }

  // Pre-fill profile from Google account metadata
  const newProfile: CustomerProfile = {
    customerId,
    name: firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Customer'),
    email: firebaseUser.email || '',
    phone: firebaseUser.phoneNumber || '',
    photoURL: firebaseUser.photoURL || null,
    authProvider: 'google.com',
    addresses: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accountStatus: 'active'
  };

  try {
    const customerRef = doc(db, 'customers', customerId);
    await setDoc(customerRef, newProfile);
    // Create the lightweight identity profile only for an explicit customer flow.
    // Owner onboarding writes restaurantId later and therefore prevents future
    // customer provisioning for the same Firebase UID.
    await setDoc(userRef, {
      userId: customerId,
      displayName: newProfile.name,
      email: newProfile.email,
      photoUrl: newProfile.photoURL || null,
      createdAt: newProfile.createdAt,
      updatedAt: newProfile.updatedAt
    }, { merge: true });
    return newProfile;
  } catch (err) {
    throw handleFirestoreError(err, OperationType.CREATE, `customers/${customerId}`);
  }
}

/**
 * Signs in the customer using Google Auth Popup.
 * Follows Milestone 9 Phase 1 guidelines: Google Sign-In only, no OTP.
 */
export async function loginCustomerWithGoogle(): Promise<{
  user: FirebaseUser;
  profile: CustomerProfile;
}> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    const profile = await provisionCustomerProfile(result.user);
    return {
      user: result.user,
      profile
    };
  } catch (err) {
    const friendlyMsg = formatCustomerAuthError(err);
    const error = new Error(friendlyMsg);
    (error as any).rawError = err;
    throw error;
  }
}

/**
 * Updates editable customer profile fields (Name, Phone, Addresses).
 * Enforces:
 * - Phone is a standard optional profile field (NO OTP verification).
 * - customerId and email are immutable from client.
 */
export async function updateCustomerProfile(
  customerId: string,
  updates: {
    name?: string;
    phone?: string;
    addresses?: CustomerAddress[];
  }
): Promise<CustomerProfile> {
  if (!customerId) {
    throw new Error('Customer ID is required to update profile.');
  }

  const patch: Record<string, any> = {
    updatedAt: new Date().toISOString()
  };

  if (typeof updates.name === 'string') {
    patch.name = updates.name.trim();
  }

  if (typeof updates.phone === 'string') {
    patch.phone = updates.phone.trim();
  }

  if (Array.isArray(updates.addresses)) {
    patch.addresses = updates.addresses;
  }

  try {
    const customerRef = doc(db, 'customers', customerId);
    await setDoc(customerRef, patch, { merge: true });

    // Fetch and return the fresh profile
    const fresh = await getCustomerProfile(customerId);
    if (!fresh) {
      throw new Error('Customer profile was not found after updating.');
    }
    return fresh;
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, `customers/${customerId}`);
  }
}

/**
 * Signs out the currently authenticated customer.
 */
export async function logoutCustomer(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('[CustomerAuth] Sign out error:', err);
    throw new Error('Failed to sign out. Please try again.');
  }
}

/**
 * Subscribes to Firebase Authentication state changes for customer sessions.
 */
export function subscribeToCustomerAuth(
  callback: (user: FirebaseUser | null) => void
): () => void {
  return onAuthStateChanged(auth, callback);
}
