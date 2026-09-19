import { describe, it, expect } from 'vitest';
import { evaluateSubscriptionEntitlements } from '../utils/subscriptionEntitlements';
import { getRestaurantOperatingProfile } from '../config/restaurantOperatingModes';
import { getEffectiveFeatureAccess } from '../utils/effectiveAccessResolver';
import { RestaurantSubscription } from '../types/subscription';
import { Restaurant } from '../types/restaurant';

function createMockSub(planId: string, status: 'active' | 'trial' | 'expired' = 'active'): RestaurantSubscription {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  return {
    subscriptionId: 'sub_test_123',
    restaurantId: 'rest_123',
    planId,
    status: status === 'expired' ? 'trial' : status,
    billingCycle: 'annual',
    trialStartedAt: past,
    trialEndsAt: status === 'expired' ? past : future,
    currentPeriodStart: past,
    currentPeriodEnd: status === 'expired' ? past : future,
    paymentStatus: 'paid',
    provider: 'razorpay',
    autoRenew: true,
    createdAt: past,
    updatedAt: past
  };
}

function createMockRestaurant(mode: 'single_person' | 'small_team' | 'full_service'): Restaurant {
  return {
    restaurantId: 'rest_123',
    name: 'Test Eatery',
    legalName: 'Test Eatery Private Limited',
    logoUrl: null,
    phone: '9876543210',
    email: 'owner@test.com',
    address: '123 Main St',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    country: 'India',
    gstNumber: '27AAAAA0000A1Z5',
    currency: 'INR',
    currencySymbol: '₹',
    timezone: 'Asia/Kolkata',
    taxMode: 'exclusive',
    defaultTaxRate: 5,
    ownerId: 'user_123',
    isActive: true,
    restaurantOperatingMode: mode
  };
}

describe('Effective Access Resolver - Dual Layer Control System', () => {
  it('Scenario 1: Starter + Full Service -> KDS blocked by Subscription ("SUBSCRIPTION_REQUIRED")', () => {
    const sub = createMockSub('starter');
    const entitlements = evaluateSubscriptionEntitlements(sub);
    const rest = createMockRestaurant('full_service');
    const operatingProfile = getRestaurantOperatingProfile(rest);

    const access = getEffectiveFeatureAccess({
      featureOrView: 'kitchen',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });

    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('SUBSCRIPTION_REQUIRED');
    expect(access.requiredPlan).toBe('Growth');
    expect(access.actionType).toBe('upgrade_plan');
  });

  it('Scenario 2: Growth + Full Service -> KDS GRANTED, Voice Assistant blocked by Subscription', () => {
    const sub = createMockSub('growth');
    const entitlements = evaluateSubscriptionEntitlements(sub);
    const rest = createMockRestaurant('full_service');
    const operatingProfile = getRestaurantOperatingProfile(rest);

    // KDS check
    const kdsAccess = getEffectiveFeatureAccess({
      featureOrView: 'kitchen',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });
    expect(kdsAccess.allowed).toBe(true);
    expect(kdsAccess.reason).toBe('GRANTED');

    // Voice Assistant check (requires Pro)
    const voiceAccess = getEffectiveFeatureAccess({
      featureOrView: 'voiceAssistant',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });
    expect(voiceAccess.allowed).toBe(false);
    expect(voiceAccess.reason).toBe('SUBSCRIPTION_REQUIRED');
    expect(voiceAccess.requiredPlan).toBe('Pro');
  });

  it('Scenario 3: Growth + Single Person mode -> KDS blocked by Operating Model ("OPERATING_MODEL_DISABLED")', () => {
    const sub = createMockSub('growth');
    const entitlements = evaluateSubscriptionEntitlements(sub);
    const rest = createMockRestaurant('single_person'); // Single person disables KDS
    const operatingProfile = getRestaurantOperatingProfile(rest);

    const access = getEffectiveFeatureAccess({
      featureOrView: 'kitchen',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });

    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('OPERATING_MODEL_DISABLED');
    expect(access.actionType).toBe('configure_operating_model');
    expect(access.message).toContain('Module turned off in Operating Model settings');
    // CRITICAL: Must NOT be SUBSCRIPTION_REQUIRED!
    expect(access.reason).not.toBe('SUBSCRIPTION_REQUIRED');
  });

  it('Scenario 3b: Growth + Small Team mode -> Captain app blocked by Operating Model ("OPERATING_MODEL_DISABLED")', () => {
    const sub = createMockSub('growth');
    const entitlements = evaluateSubscriptionEntitlements(sub);
    const rest = createMockRestaurant('small_team'); // Small team disables Captain App
    const operatingProfile = getRestaurantOperatingProfile(rest);

    const access = getEffectiveFeatureAccess({
      featureOrView: 'captain',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });

    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('OPERATING_MODEL_DISABLED');
    expect(access.actionType).toBe('configure_operating_model');
    expect(access.reason).not.toBe('SUBSCRIPTION_REQUIRED');
  });

  it('Scenario 4: Pro + Full Service -> All features GRANTED', () => {
    const sub = createMockSub('pro');
    const entitlements = evaluateSubscriptionEntitlements(sub);
    const rest = createMockRestaurant('full_service');
    const operatingProfile = getRestaurantOperatingProfile(rest);

    const kdsAccess = getEffectiveFeatureAccess({
      featureOrView: 'kitchen',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });
    expect(kdsAccess.allowed).toBe(true);
    expect(kdsAccess.reason).toBe('GRANTED');

    const voiceAccess = getEffectiveFeatureAccess({
      featureOrView: 'voiceAssistant',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });
    expect(voiceAccess.allowed).toBe(true);
    expect(voiceAccess.reason).toBe('GRANTED');
  });

  it('Expired Subscription -> EXPIRED_SUBSCRIPTION for operational features', () => {
    const sub = createMockSub('growth', 'expired');
    const entitlements = evaluateSubscriptionEntitlements(sub);
    const rest = createMockRestaurant('full_service');
    const operatingProfile = getRestaurantOperatingProfile(rest);

    const access = getEffectiveFeatureAccess({
      featureOrView: 'kitchen',
      entitlements,
      operatingProfile,
      userRole: 'owner'
    });

    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('EXPIRED_SUBSCRIPTION');
    expect(access.actionType).toBe('renew_subscription');
  });
});
