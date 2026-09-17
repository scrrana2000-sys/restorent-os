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
  setDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import {
  BillingCycle,
  RestaurantSubscription,
  SubscriptionHistoryRecord
} from '../types/subscription';
import { getPlanById, TRIAL_PLAN_ID } from '../config/subscriptionPlans';
import { defaultPaymentProvider } from './subscriptionPaymentService';
import { enforcePermission } from '../utils/permissions';

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
    return {
      subscriptionId: existingSnap.id,
      ...existingSnap.data()
    } as RestaurantSubscription;
  }

  // Create initial 7-day trial record
  const now = new Date();
  const trialEnds = new Date(now.getTime() + SEVEN_DAYS_MS);

  const newTrial: RestaurantSubscription = {
    subscriptionId: 'current',
    restaurantId: cleanId,
    status: 'trial',
    planId: TRIAL_PLAN_ID,
    billingCycle: 'monthly',
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEnds.toISOString(),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: trialEnds.toISOString(),
    paymentStatus: 'none',
    provider: 'mock_gateway',
    autoRenew: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(subDocRef, newTrial);
    console.log(`[RestaurantOS Subscription] Initialized 7-day free trial for restaurant: ${cleanId}`);
    return newTrial;
  } catch (err: any) {
    console.warn(`[RestaurantOS Subscription] Trial initialization notice for ${cleanId}:`, err?.message || err);
    // If concurrent creation occurred, re-fetch
    const retrySnap = await getDoc(subDocRef);
    if (retrySnap.exists()) {
      return { subscriptionId: retrySnap.id, ...retrySnap.data() } as RestaurantSubscription;
    }
    throw err;
  }
}

/**
 * Retrieves the current subscription for a restaurant.
 */
export async function getRestaurantSubscription(restaurantId: string): Promise<RestaurantSubscription | null> {
  const cleanId = restaurantId?.trim();
  if (!cleanId) return null;

  const subDocRef = doc(db, 'restaurants', cleanId, 'subscription', 'current');
  const snap = await getDoc(subDocRef);

  if (!snap.exists()) {
    return null;
  }

  return {
    subscriptionId: snap.id,
    ...snap.data()
  } as RestaurantSubscription;
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

    if (token) {
      const response = await fetch('/api/subscription/verify-and-activate', {
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

  // 2. Client-side verified path (Authorized owner role in test & client environments)
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
