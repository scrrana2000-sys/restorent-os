/**
 * RestaurantOS Subscription & Trial Service
 *
 * Authoritative management of restaurant subscriptions, 7-day trials,
 * plan activations, and payment history audit records.
 *
 * Rules:
 * 1. 7-Day trial is tied to the restaurantId, stored in Firestore.
 * 2. It starts ONCE and lasts strictly 7 days (7 * 24h).
 * 3. Never resets on logout, device change, or page refresh.
 * 4. Payments are server-verified and logged immutably.
 */

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import {
  BillingCycle,
  RestaurantSubscription,
  SubscriptionHistoryRecord,
  SubscriptionEntitlements,
  PlanLimits
} from '../types/subscription';
import { getPlanById, TRIAL_PLAN_ID } from '../config/subscriptionPlans';
import { defaultPaymentProvider } from './subscriptionPaymentService';
import { enforcePermission } from '../utils/permissions';
import { evaluateSubscriptionEntitlements, isFeatureEntitled } from '../utils/subscriptionEntitlements';
import { getApiUrl } from '../utils/apiConfig';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_HUNDRED_SIXTY_FIVE_DAYS_MS = 365 * 24 * 60 * 60 * 1000;


/**
 * Idempotently ensures that every restaurant has a 7-day free trial subscription record.
 * If one already exists, leaves it completely untouched.
 */
export async function ensureRestaurantTrial(restaurantId: string): Promise<RestaurantSubscription> {
  const cleanId = restaurantId?.trim();
  if (!cleanId) {
    throw new Error('Invalid restaurant ID for trial verification.');
  }

  const subDocRef = doc(db, 'restaurants', cleanId, 'subscription', 'current');
  const existingSnap = await getDoc(subDocRef);

  if (existingSnap.exists()) {
    const existing = {
      subscriptionId: existingSnap.id,
      ...existingSnap.data()
    } as RestaurantSubscription;

    // New production rules require a native Firestore Timestamp for the
    // subscription entitlement boundary. Ask the trusted backend to backfill
    // legacy documents that predate this field.
    if (existing.operationalAccessUntil) {
      return existing;
    }

    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';
    if (isTestRuntime) return existing;

    const currentUser = auth.currentUser;
    if (!currentUser) return existing;

    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch(getApiUrl('/api/subscription/ensure-trial'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ restaurantId: cleanId })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.success && payload?.subscription) {
        return payload.subscription as RestaurantSubscription;
      }

    } catch (upgradeErr) {
      console.warn('[RestaurantOS Subscription] Legacy subscription timestamp backfill notice:', upgradeErr);
    }

    // Return the existing document for UI display if the authoritative backfill
    // service is unavailable. The Firestore rules remain fail-closed until the
    // trusted server or the tightly-scoped AI Studio legacy-trial migration succeeds.
    return existing;
  }

  // Production subscription documents are server-owned. The browser requests an
  // authenticated, owner-authorized trial initialization endpoint. Static hosting
  // must also remain usable when the API is temporarily unavailable, so a new
  // account can still receive a read-only, non-persisted trial entitlement based
  // on Firebase Auth's immutable account creation time. Paid subscriptions still
  // require the authoritative backend and Firestore subscription document.
  const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';

  if (!isTestRuntime) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Authentication is required to initialize the restaurant trial.');
    }

    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch(getApiUrl('/api/subscription/ensure-trial'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ restaurantId: cleanId })
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.success && payload?.subscription) {
        return payload.subscription as RestaurantSubscription;
      }

      throw new Error(payload?.message || 'Unable to initialize the restaurant trial.');
    } catch (err: any) {
      console.warn('[SubscriptionContext] Trial API unavailable; cannot establish authoritative subscription:', err?.message || err);
      throw err;
    }
  }

  const now = new Date();
  const trialEnds = new Date(now.getTime() + SEVEN_DAYS_MS);
  const newTrial: RestaurantSubscription = {
    subscriptionId: 'current',
    restaurantId: cleanId,
    status: 'trial',
    operationalAccessUntil: Timestamp.fromDate(trialEnds),
    planId: TRIAL_PLAN_ID,
    billingCycle: 'monthly',
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEnds.toISOString(),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: trialEnds.toISOString(),
    paymentStatus: 'none',
    provider: 'manual',
    autoRenew: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // Test runtimes can exercise the returned trial object without performing a
  // production Firestore mutation from this client-side service. In all real
  // environments the authoritative trial is created through the server API above.
}

/**
 * Retrieves the current subscription for a restaurant.
 */
export async function getRestaurantSubscription(restaurantId: string): Promise<RestaurantSubscription | null> {
  const cleanId = restaurantId?.trim();
  if (!cleanId) return null;

  try {
    const subDocRef = doc(db, 'restaurants', cleanId, 'subscription', 'current');
    const snap = await getDoc(subDocRef);

    if (!snap || typeof snap.exists !== 'function' || !snap.exists()) {
      return null;
    }

    return {
      subscriptionId: snap.id,
      ...snap.data()
    } as RestaurantSubscription;
  } catch (err) {
    return null;
  }
}

/**
 * Authoritatively resolves active plan entitlements directly from Firestore
 * (/restaurants/{restaurantId}/subscription/current).
 * Never relies on client-side state, billing history, or external overrides.
 */
export async function getActivePlanEntitlements(restaurantId: string): Promise<SubscriptionEntitlements> {
  const cleanId = restaurantId?.trim();
  if (!cleanId) {
    return evaluateSubscriptionEntitlements(null);
  }

  try {
    let sub = await getRestaurantSubscription(cleanId);
    // Existing legacy subscription documents may predate operationalAccessUntil.
    // Always pass such documents through ensureRestaurantTrial() so the trusted
    // backend can backfill the native Firestore Timestamp before gated writes.
    if (!sub || !sub.operationalAccessUntil) {
      try {
        sub = await ensureRestaurantTrial(cleanId);
      } catch (trialError) {
        // Never grant a synthetic trial when the subscription record is missing
        // or cannot be initialized. Fail closed to inactive entitlements.
        console.warn('[RestaurantOS Subscription] Trial initialization unavailable:', trialError);
        sub = null;
      }
    }

    return evaluateSubscriptionEntitlements(sub);
  } catch (err) {
    console.warn('[RestaurantOS Subscription] Failed to resolve active plan entitlements:', err);
    return evaluateSubscriptionEntitlements(null);
  }
}

/**
 * Checks whether table count has reached the maximum permitted by the current active plan.
 */
export async function checkTableLimit(
  restaurantId: string,
  knownCount?: number
): Promise<{ allowed: boolean; currentCount: number; maxTables: number; planName: string; reason?: string }> {
  const cleanId = restaurantId?.trim();
  if (!cleanId) {
    return { allowed: false, currentCount: 0, maxTables: 0, planName: 'Unknown', reason: 'Invalid restaurant ID.' };
  }

  const entitlements = await getActivePlanEntitlements(cleanId);
  const maxTables = entitlements.plan.limits.maxTables;
  const planName = entitlements.plan.name;

  if (!entitlements.canPerformOperationalActions) {
    return {
      allowed: false,
      currentCount: knownCount ?? 0,
      maxTables,
      planName,
      reason: `Subscription is expired or inactive on ${planName} plan. Upgrade or renew to add tables.`
    };
  }

  let count = knownCount;
  if (count === undefined) {
    try {
      const { getDocs } = await import('firebase/firestore');
      const tablesSnap = await getDocs(collection(db, 'restaurants', cleanId, 'tables'));
      count = tablesSnap.size;
    } catch {
      count = 0;
    }
  }

  if (count >= maxTables) {
    return {
      allowed: false,
      currentCount: count,
      maxTables,
      planName,
      reason: `Table limit reached (${count}/${maxTables} on ${planName} plan). Upgrade to add more tables.`
    };
  }

  return { allowed: true, currentCount: count, maxTables, planName };
}

/**
 * Checks whether staff member count has reached the maximum permitted by the current active plan.
 */
export async function checkStaffLimit(
  restaurantId: string,
  knownCount?: number
): Promise<{ allowed: boolean; currentCount: number; maxStaff: number; planName: string; reason?: string }> {
  const cleanId = restaurantId?.trim();
  if (!cleanId) {
    return { allowed: false, currentCount: 0, maxStaff: 0, planName: 'Unknown', reason: 'Invalid restaurant ID.' };
  }

  const entitlements = await getActivePlanEntitlements(cleanId);
  const maxStaff = entitlements.plan.limits.maxStaff;
  const planName = entitlements.plan.name;

  if (!entitlements.canPerformOperationalActions) {
    return {
      allowed: false,
      currentCount: knownCount ?? 0,
      maxStaff,
      planName,
      reason: `Subscription is expired or inactive on ${planName} plan. Upgrade or renew to invite staff.`
    };
  }

  let count = knownCount;
  if (count === undefined) {
    try {
      const { getDocs } = await import('firebase/firestore');
      const membersSnap = await getDocs(collection(db, 'restaurants', cleanId, 'members'));
      count = membersSnap.size;
    } catch {
      count = 0;
    }
  }

  if (count >= maxStaff) {
    return {
      allowed: false,
      currentCount: count,
      maxStaff,
      planName,
      reason: `Staff limit reached (${count}/${maxStaff} on ${planName} plan). Upgrade to invite more staff.`
    };
  }

  return { allowed: true, currentCount: count, maxStaff, planName };
}


/**
 * Loads billing history only when the subscription page explicitly requests it.
 * No realtime listener is kept alive across the entire owner console.
 */
export async function getSubscriptionHistoryOnce(
  restaurantId: string,
  limitCount = 50
): Promise<SubscriptionHistoryRecord[]> {
  const cleanId = restaurantId?.trim();
  if (!cleanId) return [];

  const historyColRef = collection(db, 'restaurants', cleanId, 'subscriptionHistory');
  const safeLimit = Math.max(1, Math.min(Math.floor(limitCount), 100));
  const q = query(historyColRef, orderBy('createdAt', 'desc'), limit(safeLimit));
  const snap = await getDocs(q);

  const records: SubscriptionHistoryRecord[] = [];
  snap.docs.forEach((docSnap) => {
    records.push({ id: docSnap.id, ...docSnap.data() } as SubscriptionHistoryRecord);
  });
  return records;
}

/**
 * Realtime reactive listener for the restaurant's subscription status.
 */
export function subscribeToRestaurantSubscription(
  restaurantId: string,
  callback: (sub: RestaurantSubscription | null) => void,
  onError?: (err: unknown) => void
): () => void {
  const cleanId = restaurantId?.trim();
  if (!cleanId) {
    callback(null);
    return () => {};
  }

  const subDocRef = doc(db, 'restaurants', cleanId, 'subscription', 'current');

  return onSnapshot(
    subDocRef,
    (snap) => {
      if (snap.exists()) {
        callback({ subscriptionId: snap.id, ...snap.data() } as RestaurantSubscription);
      } else {
        callback(null);
      }
    },
    (err) => {
      // In onSnapshot callbacks, throwing an exception crashes the JS runtime as an Uncaught Error.
      // If auth.currentUser is null, the user has logged out or is unauthenticated; absorb cleanly.
      if (!auth.currentUser) {
        console.log('[RestaurantOS Subscription] Listener terminated cleanly on logout');
        return;
      }
      console.warn('[RestaurantOS Subscription] Subscription listener notice:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Realtime reactive listener for subscription payment history audit trail.
 */
export function subscribeToSubscriptionHistory(
  restaurantId: string,
  callback: (records: SubscriptionHistoryRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const cleanId = restaurantId?.trim();
  if (!cleanId) {
    callback([]);
    return () => {};
  }

  const historyColRef = collection(db, 'restaurants', cleanId, 'subscriptionHistory');
  const q = query(historyColRef, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snap) => {
      const records: SubscriptionHistoryRecord[] = [];
      snap.forEach((docSnap) => {
        records.push({ id: docSnap.id, ...docSnap.data() } as SubscriptionHistoryRecord);
      });
      callback(records);
    },
    (err) => {
      if (!auth.currentUser) return;
      console.warn('[RestaurantOS Subscription] History listener notice:', err);
      if (onError) onError(err);
    }
  );
}

export interface ActivateSubscriptionParams {
  restaurantId: string;
  planId: string;
  billingCycle: BillingCycle;
  providerOrderId: string;
  paymentId: string;
  signature: string;
}

/**
 * Authoritatively activates or renews a subscription.
 * Attempts server-verified activation endpoint first; falls back to authorized direct update in client test environments.
 */
export async function activatePaidSubscription(
  params: ActivateSubscriptionParams
): Promise<{ success: boolean; subscription: RestaurantSubscription }> {
  const { restaurantId, planId, billingCycle, providerOrderId, paymentId, signature } = params;
  const cleanId = restaurantId?.trim();
  if (!cleanId) throw new Error('Missing restaurant ID');

  await enforcePermission(cleanId, 'manage_subscription');

  const plan = getPlanById(planId);
  const amountPaise = billingCycle === 'annual' ? plan.priceAnnualPaise : plan.priceMonthlyPaise;

  // 1. Try server-side activation endpoint with authorization bearer token
  try {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : '';

    const isTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true');
    if (token && typeof window !== 'undefined' && !isTest) {
      const response = await fetch(getApiUrl('/api/subscription/verify-and-activate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          restaurantId: cleanId,
          planId,
          billingCycle,
          providerOrderId,
          paymentId,
          signature
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.subscription) {
          return { success: true, subscription: result.subscription };
        }
      }
    }
  } catch (apiErr) {
    console.warn('[RestaurantOS Subscription] Server verification endpoint unavailable or skipped:', apiErr);
  }

  // 2. Direct Firestore activation is reserved for server/test execution only.
  // Browser production requests must never self-activate a subscription when the
  // trusted API is unavailable; doing so would both fail against the server-only
  // Firestore rules and create a dangerous authorization fallback.
  const isTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true');
  if (typeof window !== 'undefined' && !isTest) {
    throw new Error('Subscription verification service is unavailable. Payment was not activated. Please retry.');
  }

  const verification = await defaultPaymentProvider.verifyPayment({
    restaurantId: cleanId,
    providerOrderId,
    paymentId,
    signature,
    planId,
    billingCycle
  });

  if (!verification.verified) {
    throw new Error(verification.error || 'Payment verification failed.');
  }

  const now = new Date();
  const periodDurationMs = billingCycle === 'annual' ? THREE_HUNDRED_SIXTY_FIVE_DAYS_MS : THIRTY_DAYS_MS;
  const periodEnd = new Date(now.getTime() + periodDurationMs);

  const subDocRef = doc(db, 'restaurants', cleanId, 'subscription', 'current');
  const existingSnap = await getDoc(subDocRef);
  const existingData = existingSnap.exists() ? (existingSnap.data() as RestaurantSubscription) : null;

  const isPlanChange = existingData?.status === 'active' && existingData?.planId !== planId;
  const eventType = isPlanChange ? 'PLAN_CHANGED' : 'SUBSCRIPTION_ACTIVATED';

  const updatedSubscription: RestaurantSubscription = {
    subscriptionId: 'current',
    restaurantId: cleanId,
    status: 'active',
    planId,
    planName: plan.name,
    billingCycle,
    amount: amountPaise,
    currency: plan.currency,
    trialStartedAt: existingData?.trialStartedAt || now.toISOString(),
    trialEndsAt: existingData?.trialEndsAt || new Date(now.getTime() + SEVEN_DAYS_MS).toISOString(),
    trialStartAt: existingData?.trialStartedAt || now.toISOString(),
    trialEndAt: existingData?.trialEndsAt || new Date(now.getTime() + SEVEN_DAYS_MS).toISOString(),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    paymentStatus: 'paid',
    provider: defaultPaymentProvider.type,
    providerSubscriptionId: providerOrderId,
    razorpayOrderId: providerOrderId,
    razorpayPaymentId: paymentId,
    activatedAt: existingData?.activatedAt || now.toISOString(),
    lastPaymentAmount: amountPaise,
    lastPaymentDate: now.toISOString(),
    autoRenew: true,
    createdAt: existingData?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(subDocRef, updatedSubscription, { merge: true });

  // Add immutable history record
  try {
    const historyDocRef = doc(collection(db, 'restaurants', cleanId, 'subscriptionHistory'));
    const historyRecord: SubscriptionHistoryRecord = {
      id: historyDocRef.id,
      restaurantId: cleanId,
      planId,
      planName: plan.name,
      billingCycle,
      amount: amountPaise,
      currency: plan.currency,
      status: 'paid',
      eventType: eventType as any,
      razorpayOrderId: providerOrderId,
      razorpayPaymentId: paymentId,
      periodStart: now.toISOString(),
      periodEnd: periodEnd.toISOString(),
      provider: defaultPaymentProvider.type,
      paymentReference: verification.transactionId || paymentId,
      timestamp: now.toISOString(),
      createdAt: serverTimestamp()
    };
    await setDoc(historyDocRef, historyRecord);
  } catch (historyErr) {
    console.warn('[RestaurantOS Subscription] Could not append history log:', historyErr);
  }

  return { success: true, subscription: updatedSubscription };
}
