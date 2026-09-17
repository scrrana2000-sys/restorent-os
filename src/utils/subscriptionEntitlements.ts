/**
 * RestaurantOS Subscription Entitlements & Helpers
 *
 * Centralized evaluation of subscription validity, trial countdown,
 * expiration states, and operational permissions.
 */

import { RestaurantSubscription, SubscriptionEntitlements, SubscriptionStatus } from '../types/subscription';
import { getPlanById, TRIAL_PLAN_ID } from '../config/subscriptionPlans';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Resolves the effective status of a subscription, accounting for wall-clock expiry.
 */
export function getEffectiveSubscriptionStatus(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): SubscriptionStatus {
  if (!sub) return 'trial_expired';

  const currentTime = now.getTime();

  // If status is recorded as trial, check if trial period has passed
  if (sub.status === 'trial') {
    const trialEndTime = new Date(sub.trialEndsAt).getTime();
    if (currentTime > trialEndTime) {
      return 'trial_expired';
    }
    return 'trial';
  }

  // If status is recorded as active, check if current period has passed
  if (sub.status === 'active') {
    const periodEndTime = new Date(sub.currentPeriodEnd).getTime();
    if (currentTime > periodEndTime) {
      return 'expired';
    }
    return 'active';
  }

  return sub.status;
}

/**
 * Checks if subscription has a valid, active trial.
 */
export function hasValidTrial(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sub) return false;
  const effective = getEffectiveSubscriptionStatus(sub, now);
  return effective === 'trial';
}

/**
 * Checks if subscription has an active, paid entitlement or active trial.
 */
export function hasActiveSubscription(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sub) return false;
  const effective = getEffectiveSubscriptionStatus(sub, now);
  return effective === 'active' || effective === 'trial' || effective === 'grace_period';
}

/**
 * Checks if subscription or trial has elapsed.
 */
export function isSubscriptionExpired(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sub) return true;
  const effective = getEffectiveSubscriptionStatus(sub, now);
  return effective === 'trial_expired' || effective === 'expired';
}

/**
 * Calculates remaining days and hours on trial or active period.
 */
export function getRemainingTime(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): { days: number; hours: number; totalMs: number; isExpired: boolean } {
  if (!sub) return { days: 0, hours: 0, totalMs: 0, isExpired: true };

  const targetDateStr = sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd;
  const targetTime = new Date(targetDateStr).getTime();
  const diffMs = targetTime - now.getTime();

  if (diffMs <= 0) {
    return { days: 0, hours: 0, totalMs: 0, isExpired: true };
  }

  const days = Math.floor(diffMs / ONE_DAY_MS);
  const hours = Math.floor((diffMs % ONE_DAY_MS) / ONE_HOUR_MS);

  return { days, hours, totalMs: diffMs, isExpired: false };
}

/**
 * Checks if subscription or trial is expiring soon (<= 2 days).
 */
export function isExpiringSoon(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sub) return false;
  const { days, isExpired } = getRemainingTime(sub, now);
  if (isExpired) return false;
  return days <= 2;
}

/**
 * Returns whether restaurant staff can perform core operational actions (create orders, modify inventory, etc.).
 * When expired, operations are locked while existing historical data, reports, and settings remain viewable.
 */
export function canPerformOperationalActions(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): boolean {
  return hasActiveSubscription(sub, now);
}

/**
 * Compiles full entitlement summary object.
 */
export function evaluateSubscriptionEntitlements(
  sub: RestaurantSubscription | null | undefined,
  now: Date = new Date()
): SubscriptionEntitlements {
  const effectiveStatus = getEffectiveSubscriptionStatus(sub, now);
  const activeSub = hasActiveSubscription(sub, now);
  const validTrial = hasValidTrial(sub, now);
  const expired = isSubscriptionExpired(sub, now);
  const { days, hours } = getRemainingTime(sub, now);
  const expiringSoon = isExpiringSoon(sub, now);
  const plan = getPlanById(sub?.planId || TRIAL_PLAN_ID);

  return {
    status: effectiveStatus,
    hasActiveSubscription: activeSub,
    hasValidTrial: validTrial,
    isSubscriptionExpired: expired,
    isExpiringSoon: expiringSoon,
    daysRemaining: days,
    hoursRemaining: hours,
    canPerformOperationalActions: activeSub,
    plan
  };
}

/**
 * Formats date into readable string e.g. "24/09/2026" or "24 Sep 2026".
 */
export function formatSubscriptionDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}
