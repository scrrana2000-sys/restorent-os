import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateSubscriptionEntitlements,
  formatSubscriptionDate,
  getEffectiveSubscriptionStatus,
  getRemainingTime,
  isExpiringSoon
} from '../utils/subscriptionEntitlements';
import {
  SUBSCRIPTION_PLANS,
  COMMERCIAL_PLANS,
  CUSTOMIZATION_CONFIG,
  getPlanById,
  formatPlanPrice,
  TRIAL_PLAN_ID
} from '../config/subscriptionPlans';
import {
  MockSubscriptionGatewayProvider,
  defaultPaymentProvider
} from '../services/subscriptionPaymentService';
import { hasPermission, isViewAllowed } from '../utils/permissions';
import { RestaurantSubscription } from '../types/subscription';

// Mock firebase/firestore for SubscriptionService tests
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: vi.fn((_db, ...pathSegments) => ({
      id: pathSegments[pathSegments.length - 1],
      path: pathSegments.join('/')
    })),
    collection: vi.fn((_db, ...pathSegments) => ({
      id: pathSegments[pathSegments.length - 1],
      path: pathSegments.join('/')
    })),
    getDoc: vi.fn(async () => ({
      exists: () => false,
      data: () => null,
      id: 'current'
    })),
    setDoc: vi.fn(async () => Promise.resolve()),
    addDoc: vi.fn(async (_col, data) => ({ id: 'hist_123', ...data })),
    serverTimestamp: vi.fn(() => new Date().toISOString())
  };
});

describe('RestaurantOS Subscription System — Final Commercial Plans & Customization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Commercial Plan Pricing & Currency', () => {
    it('configures Starter price = ₹299 / month', () => {
      const starter = getPlanById('starter');
      expect(starter).toBeDefined();
      expect(starter.name).toBe('Starter');
      expect(starter.price).toBe(299);
      expect(starter.priceMonthlyPaise).toBe(29900);
      expect(formatPlanPrice(starter.priceMonthlyPaise)).toBe('₹299');
      expect(starter.currency).toBe('INR');
      expect(starter.currencySymbol).toBe('₹');
      expect(starter.billingCycle).toBe('monthly');
    });

    it('configures Growth price = ₹699 / month', () => {
      const growth = getPlanById('growth');
      expect(growth).toBeDefined();
      expect(growth.name).toBe('Growth');
      expect(growth.price).toBe(699);
      expect(growth.priceMonthlyPaise).toBe(69900);
      expect(formatPlanPrice(growth.priceMonthlyPaise)).toBe('₹699');
      expect(growth.currency).toBe('INR');
      expect(growth.currencySymbol).toBe('₹');
      expect(growth.billingCycle).toBe('monthly');
    });

    it('configures Pro price = ₹999 / month', () => {
      const pro = getPlanById('pro');
      expect(pro).toBeDefined();
      expect(pro.name).toBe('Pro');
      expect(pro.price).toBe(999);
      expect(pro.priceMonthlyPaise).toBe(99900);
      expect(formatPlanPrice(pro.priceMonthlyPaise)).toBe('₹999');
      expect(pro.currency).toBe('INR');
      expect(pro.currencySymbol).toBe('₹');
      expect(pro.billingCycle).toBe('monthly');
    });

    it('ensures all commercial plans use INR and rupee symbol', () => {
      COMMERCIAL_PLANS.forEach((plan) => {
        expect(plan.currency).toBe('INR');
        expect(plan.currencySymbol).toBe('₹');
        expect(plan.billingCycle).toBe('monthly');
        expect(plan.priceMonthlyPaise).toBeGreaterThan(0);
      });
    });

    it('preserves accurate feature sets and operational limits', () => {
      const starter = getPlanById('starter');
      const growth = getPlanById('growth');
      const pro = getPlanById('pro');

      // Starter limits
      expect(starter.limits.maxTables).toBe(15);
      expect(starter.limits.maxStaff).toBe(5);
      expect(starter.limits.multiDevice).toBe(false);
      expect(starter.limits.onlineOrdering).toBe(false);
      expect(starter.limits.voiceAssistant).toBe(false);

      // Growth limits
      expect(growth.limits.maxTables).toBe(50);
      expect(growth.limits.maxStaff).toBe(15);
      expect(growth.limits.multiDevice).toBe(true);
      expect(growth.limits.onlineOrdering).toBe(true);
      expect(growth.limits.voiceAssistant).toBe(false);

      // Pro limits
      expect(pro.limits.maxTables).toBe(100);
      expect(pro.limits.maxStaff).toBe(50);
      expect(pro.limits.multiDevice).toBe(true);
      expect(pro.limits.onlineOrdering).toBe(true);
      expect(pro.limits.voiceAssistant).toBe(true);
    });
  });

  describe('Plan Display Ordering', () => {
    it('strictly orders commercial plans as Starter -> Growth -> Pro', () => {
      expect(COMMERCIAL_PLANS).toHaveLength(3);
      expect(COMMERCIAL_PLANS[0].planId).toBe('starter');
      expect(COMMERCIAL_PLANS[1].planId).toBe('growth');
      expect(COMMERCIAL_PLANS[2].planId).toBe('pro');

      expect(COMMERCIAL_PLANS[0].name).toBe('Starter');
      expect(COMMERCIAL_PLANS[1].name).toBe('Growth');
      expect(COMMERCIAL_PLANS[2].name).toBe('Pro');
    });
  });

  describe('Customization Option', () => {
    it('is configured as a separate solution tier, not a standard checkout plan', () => {
      // Must not be in standard self-serve plan catalogs
      const inCommercial = COMMERCIAL_PLANS.some((p) => p.planId === 'customization');
      const inAllPlans = SUBSCRIPTION_PLANS.some((p) => p.planId === 'customization');
      expect(inCommercial).toBe(false);
      expect(inAllPlans).toBe(false);
    });

    it('provides clear messaging, Contact Us action, and correct contact email', () => {
      expect(CUSTOMIZATION_CONFIG.heading).toBe('Need a Custom Solution?');
      expect(CUSTOMIZATION_CONFIG.title).toBe('Customization');
      expect(CUSTOMIZATION_CONFIG.description).toContain(
        'For restaurants/businesses requiring custom features, integrations, branding or special requirements.'
      );
      expect(CUSTOMIZATION_CONFIG.buttonText).toBe('Contact Us');
      expect(CUSTOMIZATION_CONFIG.contactEmail).toBe('radhachawan01@gmail.com');
      expect(CUSTOMIZATION_CONFIG.mailtoUrl).toBe(
        'mailto:radhachawan01@gmail.com?subject=RestaurantOS%20Customization%20Inquiry'
      );
    });
  });

  describe('7-Day Free Trial Functionality & Immutability', () => {
    const fixedNow = new Date('2026-09-17T12:00:00Z');

    it('evaluates active 7-day trial correctly', () => {
      const futureDate = new Date(fixedNow.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const trialSub: RestaurantSubscription = {
        subscriptionId: 'current',
        restaurantId: 'rest-100',
        planId: TRIAL_PLAN_ID,
        status: 'trial',
        billingCycle: 'monthly',
        trialStartedAt: fixedNow.toISOString(),
        trialEndsAt: futureDate,
        currentPeriodStart: fixedNow.toISOString(),
        currentPeriodEnd: futureDate,
        paymentStatus: 'none',
        provider: 'mock_gateway',
        autoRenew: false,
        createdAt: fixedNow.toISOString(),
        updatedAt: fixedNow.toISOString()
      };

      const entitlements = evaluateSubscriptionEntitlements(trialSub, fixedNow);
      expect(entitlements.status).toBe('trial');
      expect(entitlements.hasActiveSubscription).toBe(true);
      expect(entitlements.canPerformOperationalActions).toBe(true);
      expect(entitlements.daysRemaining).toBe(5);
      expect(entitlements.isExpiringSoon).toBe(false);
      expect(entitlements.isSubscriptionExpired).toBe(false);
    });

    it('marks trial as expired when 7-day period has passed without payment', () => {
      const pastDate = new Date(fixedNow.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const trialSub: RestaurantSubscription = {
        subscriptionId: 'current',
        restaurantId: 'rest-100',
        planId: TRIAL_PLAN_ID,
        status: 'trial',
        billingCycle: 'monthly',
        trialStartedAt: new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        trialEndsAt: pastDate,
        currentPeriodStart: new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        currentPeriodEnd: pastDate,
        paymentStatus: 'none',
        provider: 'mock_gateway',
        autoRenew: false,
        createdAt: fixedNow.toISOString(),
        updatedAt: fixedNow.toISOString()
      };

      const entitlements = evaluateSubscriptionEntitlements(trialSub, fixedNow);
      expect(entitlements.status).toBe('trial_expired');
      expect(entitlements.hasActiveSubscription).toBe(false);
      expect(entitlements.canPerformOperationalActions).toBe(false);
      expect(entitlements.isSubscriptionExpired).toBe(true);
    });

    it('ensures trial initialization is strictly restaurantId-scoped and lasts 7 days', async () => {
      const { ensureRestaurantTrial } = await import('../services/subscriptionService');
      const sub = await ensureRestaurantTrial('rest-scoped-test');
      expect(sub.restaurantId).toBe('rest-scoped-test');
      expect(sub.status).toBe('trial');
      expect(sub.planId).toBe(TRIAL_PLAN_ID);

      const trialEnd = new Date(sub.trialEndsAt);
      const trialStart = new Date(sub.trialStartedAt);
      const diffDays = Math.round((trialEnd.getTime() - trialStart.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(7);
    });
  });

  describe('Security & Multi-Tenant Isolation', () => {
    it('grants full subscription access & management to Owner', () => {
      expect(hasPermission('owner', 'access_subscription')).toBe(true);
      expect(hasPermission('owner', 'manage_subscription')).toBe(true);
      expect(isViewAllowed('owner', 'subscription')).toBe(true);
    });

    it('allows Manager read-only visibility into subscription status', () => {
      expect(hasPermission('manager', 'access_subscription')).toBe(true);
      expect(hasPermission('manager', 'manage_subscription')).toBe(false);
      expect(isViewAllowed('manager', 'subscription')).toBe(true);
    });

    it('strictly denies subscription access to non-manager operational staff', () => {
      const restrictedRoles: any[] = ['cashier', 'kitchen', 'captain', 'accountant'];
      restrictedRoles.forEach((role) => {
        expect(hasPermission(role, 'access_subscription')).toBe(false);
        expect(hasPermission(role, 'manage_subscription')).toBe(false);
        expect(isViewAllowed(role, 'subscription')).toBe(false);
      });
    });
  });

  describe('Payment Provider Abstraction & Activation', () => {
    it('creates and verifies payment orders with exact plan pricing', async () => {
      const provider = new MockSubscriptionGatewayProvider();

      // Test Starter payment order
      const starterOrder = await provider.createPaymentOrder({
        restaurantId: 'rest-tenant-a',
        planId: 'starter',
        billingCycle: 'monthly'
      });
      expect(starterOrder.amountPaise).toBe(29900);
      expect(starterOrder.currency).toBe('INR');

      // Test Growth payment order
      const growthOrder = await provider.createPaymentOrder({
        restaurantId: 'rest-tenant-a',
        planId: 'growth',
        billingCycle: 'monthly'
      });
      expect(growthOrder.amountPaise).toBe(69900);
      expect(growthOrder.currency).toBe('INR');

      // Test Pro payment order
      const proOrder = await provider.createPaymentOrder({
        restaurantId: 'rest-tenant-a',
        planId: 'pro',
        billingCycle: 'monthly'
      });
      expect(proOrder.amountPaise).toBe(99900);
      expect(proOrder.currency).toBe('INR');

      // Verification check
      const verification = await provider.verifyPayment({
        restaurantId: 'rest-tenant-a',
        providerOrderId: proOrder.providerOrderId,
        paymentId: 'pay_test_pro_1',
        signature: 'valid_signature_token',
        planId: 'pro',
        billingCycle: 'monthly'
      });
      expect(verification.verified).toBe(true);
      expect(verification.transactionId).toBeDefined();
    });

    it('activates paid subscription with authoritative status update', async () => {
      const { activatePaidSubscription } = await import('../services/subscriptionService');
      const result = await activatePaidSubscription({
        restaurantId: 'rest-tenant-verified',
        planId: 'growth',
        billingCycle: 'monthly',
        providerOrderId: 'ord_growth_123',
        paymentId: 'pay_growth_123',
        signature: 'valid_sig_growth'
      });

      expect(result.success).toBe(true);
      expect(result.subscription.status).toBe('active');
      expect(result.subscription.planId).toBe('growth');
      expect(result.subscription.billingCycle).toBe('monthly');
      expect(result.subscription.paymentStatus).toBe('paid');
      expect(result.subscription.lastPaymentAmount).toBe(69900);
    });
  });
});
