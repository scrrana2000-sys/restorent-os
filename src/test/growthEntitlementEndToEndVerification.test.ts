import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateSubscriptionEntitlements,
  isFeatureEntitled,
  isViewPlanEntitled,
  getMinimumRequiredPlan
} from '../utils/subscriptionEntitlements';
import { getPlanById, COMMERCIAL_PLANS, formatPlanPrice } from '../config/subscriptionPlans';
import {
  getActivePlanEntitlements,
  checkTableLimit,
  checkStaffLimit,
  getRestaurantSubscription,
  activatePaidSubscription
} from '../services/subscriptionService';
import { tableService } from '../services/tableService';
import { staffService } from '../services/staffService';
import { submitCustomerOnlineOrder } from '../services/customerCheckoutService';
import { RestaurantSubscription, SubscriptionHistoryRecord } from '../types/subscription';
import { MockSubscriptionGatewayProvider } from '../services/subscriptionPaymentService';

// In-memory Firestore mock store to simulate actual multi-tenant database state
const mockDb: Record<string, any> = {};

vi.mock('../config/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'owner_user_1',
      email: 'owner@growthrestaurant.com',
      emailVerified: true,
      getIdToken: vi.fn(async () => 'mock-id-token-123')
    }
  }
}));

vi.mock('../utils/permissions', () => ({
  enforcePermission: vi.fn(async () => true),
  hasPermission: vi.fn(() => true),
  isViewAllowed: vi.fn(() => true)
}));

vi.mock('../services/auditService', () => ({
  auditService: {
    logEvent: vi.fn(async () => Promise.resolve())
  }
}));

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((...args: any[]) => {
      if (args.length === 1 && args[0]?.path) {
        // doc(colRef) pattern: generates random ID
        const autoId = 'auto_doc_' + Math.random().toString(36).substring(2, 9);
        return {
          path: `${args[0].path}/${autoId}`,
          id: autoId
        };
      }
      const segments = args.filter((arg) => typeof arg === 'string');
      const docId = segments[segments.length - 1];
      return {
        path: segments.join('/'),
        id: docId
      };
    }),
    collection: vi.fn((_db, ...segments) => ({
      path: segments.join('/'),
      id: segments[segments.length - 1]
    })),
    getDoc: vi.fn(async (docRef) => {
      const data = mockDb[docRef.path];
      return {
        exists: () => data !== undefined,
        data: () => data || null,
        id: docRef.id
      };
    }),
    getDocs: vi.fn(async (colRef) => {
      const entries = Object.entries(mockDb).filter(([path]) =>
        path.startsWith(colRef.path + '/')
      );
      return {
        size: entries.length,
        docs: entries.map(([path, data]) => ({
          id: path.split('/').pop(),
          data: () => data
        }))
      };
    }),
    setDoc: vi.fn(async (docRef, data, options) => {
      if (options?.merge && mockDb[docRef.path]) {
        mockDb[docRef.path] = { ...mockDb[docRef.path], ...data };
      } else {
        mockDb[docRef.path] = data;
      }
    }),
    addDoc: vi.fn(async (colRef, data) => {
      const autoId = 'auto_' + Math.random().toString(36).substring(2, 9);
      const docPath = `${colRef.path}/${autoId}`;
      mockDb[docPath] = data;
      return { id: autoId, path: docPath };
    }),
    updateDoc: vi.fn(async (docRef, data) => {
      if (!mockDb[docRef.path]) {
        throw new Error(`Document does not exist: ${docRef.path}`);
      }
      mockDb[docRef.path] = { ...mockDb[docRef.path], ...data };
    }),
    serverTimestamp: vi.fn(() => new Date().toISOString())
  };
});

describe('RestaurantOS Real End-to-End Entitlement Verification (Growth Plan ₹699)', () => {
  const RESTAURANT_GROWTH = 'rest_growth_test_101';
  const RESTAURANT_STARTER = 'rest_starter_test_202';
  const RESTAURANT_PRO = 'rest_pro_test_303';
  const FIXED_NOW = new Date('2026-09-17T14:15:00Z');

  beforeEach(() => {
    // Clear in-memory mock store
    for (const key of Object.keys(mockDb)) {
      delete mockDb[key];
    }
    vi.clearAllMocks();

    // Populate active Growth Subscription at /restaurants/rest_growth_test_101/subscription/current
    const growthSub: RestaurantSubscription = {
      subscriptionId: 'current',
      restaurantId: RESTAURANT_GROWTH,
      planId: 'growth',
      status: 'active',
      billingCycle: 'monthly',
      trialStartedAt: new Date(FIXED_NOW.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      trialEndsAt: new Date(FIXED_NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      currentPeriodStart: new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      currentPeriodEnd: new Date(FIXED_NOW.getTime() + 25 * 24 * 60 * 60 * 1000).toISOString(),
      paymentStatus: 'paid',
      provider: 'mock_gateway',
      razorpayOrderId: 'ord_growth_live_001',
      razorpayPaymentId: 'pay_growth_live_001',
      lastPaymentAmount: 69900,
      autoRenew: true,
      createdAt: new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: FIXED_NOW.toISOString()
    };
    mockDb[`restaurants/${RESTAURANT_GROWTH}/subscription/current`] = growthSub;
  });

  // TEST 1 — CURRENT PLAN
  describe('TEST 1 — CURRENT PLAN & PRICING VERIFICATION', () => {
    it('verifies the application reads Growth at ₹699/month with active subscription', async () => {
      const growthPlan = getPlanById('growth');
      expect(growthPlan).toBeDefined();
      expect(growthPlan.name).toBe('Growth');
      expect(growthPlan.price).toBe(699);
      expect(growthPlan.priceMonthlyPaise).toBe(69900);
      expect(formatPlanPrice(growthPlan.priceMonthlyPaise)).toBe('₹699');
      expect(growthPlan.billingCycle).toBe('monthly');
      expect(growthPlan.currency).toBe('INR');
      expect(growthPlan.currencySymbol).toBe('₹');

      const rawSub = await getRestaurantSubscription(RESTAURANT_GROWTH);
      expect(rawSub).not.toBeNull();
      expect(rawSub?.planId).toBe('growth');
      expect(rawSub?.status).toBe('active');
      expect(rawSub?.paymentStatus).toBe('paid');

      const entitlements = await getActivePlanEntitlements(RESTAURANT_GROWTH);
      expect(entitlements.plan.planId).toBe('growth');
      expect(entitlements.plan.name).toBe('Growth');
      expect(entitlements.status).toBe('active');
      expect(entitlements.hasActiveSubscription).toBe(true);
      expect(entitlements.canPerformOperationalActions).toBe(true);
      expect(entitlements.isSubscriptionExpired).toBe(false);
    });
  });

  // TEST 2 — TABLE QUOTA
  describe('TEST 2 — TABLE QUOTA (GROWTH: 50 TABLES)', () => {
    it('verifies Growth maximum is 50 tables, Starter 15 limit is NOT applied, and table 51 is blocked', async () => {
      // 1. Quota check with 0 tables
      const checkEmpty = await checkTableLimit(RESTAURANT_GROWTH, 0);
      expect(checkEmpty.allowed).toBe(true);
      expect(checkEmpty.maxTables).toBe(50);
      expect(checkEmpty.planName).toBe('Growth');

      // 2. Quota check at 20 tables (which would exceed Starter 15, but is well within Growth 50)
      const check20 = await checkTableLimit(RESTAURANT_GROWTH, 20);
      expect(check20.allowed).toBe(true);
      expect(check20.maxTables).toBe(50);

      // 3. Quota check at 49 tables
      const check49 = await checkTableLimit(RESTAURANT_GROWTH, 49);
      expect(check49.allowed).toBe(true);

      // 4. Quota check at 50 tables (limit reached, creating #51 blocked)
      const check50 = await checkTableLimit(RESTAURANT_GROWTH, 50);
      expect(check50.allowed).toBe(false);
      expect(check50.reason).toContain('Table limit reached (50/50 on Growth plan)');

      // 5. Verify tableService.createTable creates when count < 50
      const createdTable = await tableService.createTable(
        RESTAURANT_GROWTH,
        {
          name: 'Table 1',
          tableNumber: 'T-01',
          capacity: 4,
          floorOrArea: 'Main Floor',
          isActive: true,
          sortOrder: 1
        },
        'owner_user_1'
      );
      expect(createdTable.id).toBeDefined();
      expect(createdTable.tableNumber).toBe('T-01');

      // 6. Populate mock DB to 50 tables and verify service rejects 51st table
      for (let i = 2; i <= 50; i++) {
        mockDb[`restaurants/${RESTAURANT_GROWTH}/tables/tab_${i}`] = {
          restaurantId: RESTAURANT_GROWTH,
          tableNumber: `T-${i}`,
          name: `Table ${i}`,
          capacity: 4,
          status: 'available'
        };
      }

      await expect(
        tableService.createTable(
          RESTAURANT_GROWTH,
          {
            name: 'Table 51',
            tableNumber: 'T-51',
            capacity: 4,
            floorOrArea: 'Main Floor',
            isActive: true,
            sortOrder: 51
          },
          'owner_user_1'
        )
      ).rejects.toThrow(/Table limit reached/);
    });
  });

  // TEST 3 — STAFF QUOTA
  describe('TEST 3 — STAFF QUOTA (GROWTH: 15 STAFF)', () => {
    it('verifies Growth maximum is 15 staff, Starter 5 limit is NOT applied, and staff 16 is rejected', async () => {
      // 1. Quota check with 0 staff
      const checkEmpty = await checkStaffLimit(RESTAURANT_GROWTH, 0);
      expect(checkEmpty.allowed).toBe(true);
      expect(checkEmpty.maxStaff).toBe(15);
      expect(checkEmpty.planName).toBe('Growth');

      // 2. Quota check at 8 staff (which would exceed Starter 5, but is well within Growth 15)
      const check8 = await checkStaffLimit(RESTAURANT_GROWTH, 8);
      expect(check8.allowed).toBe(true);
      expect(check8.maxStaff).toBe(15);

      // 3. Quota check at 14 staff
      const check14 = await checkStaffLimit(RESTAURANT_GROWTH, 14);
      expect(check14.allowed).toBe(true);

      // 4. Quota check at 15 staff (limit reached, adding #16 blocked)
      const check15 = await checkStaffLimit(RESTAURANT_GROWTH, 15);
      expect(check15.allowed).toBe(false);
      expect(check15.reason).toContain('Staff limit reached (15/15 on Growth plan)');

      // 5. Test staffService.addStaffMember creates below limit
      const staffMember = await staffService.addStaffMember(
        RESTAURANT_GROWTH,
        {
          email: 'captain1@growthtest.com',
          displayName: 'Captain John',
          role: 'captain'
        }
      );
      expect(staffMember.member.email).toBe('captain1@growthtest.com');

      // 6. Populate mock DB to 15 staff members and verify service rejects 16th staff
      for (let i = 2; i <= 15; i++) {
        mockDb[`restaurants/${RESTAURANT_GROWTH}/members/mem_${i}`] = {
          restaurantId: RESTAURANT_GROWTH,
          userId: `user_${i}`,
          email: `staff${i}@growthtest.com`,
          displayName: `Staff ${i}`,
          role: 'kitchen',
          status: 'active'
        };
      }

      await expect(
        staffService.addStaffMember(
          RESTAURANT_GROWTH,
          {
            email: 'extra_staff@growthtest.com',
            displayName: 'Extra Staff',
            role: 'kitchen'
          }
        )
      ).rejects.toThrow(/Staff limit reached/);
    });
  });

  // TEST 4 — GROWTH FEATURES
  describe('TEST 4 — GROWTH FEATURES ACCESSIBILITY', () => {
    it('verifies actual access to all Growth features without "Upgrade to Growth" roadblocks', async () => {
      const entitlements = await getActivePlanEntitlements(RESTAURANT_GROWTH);
      const limits = entitlements.plan.limits;

      // Operational entitlements
      expect(limits.multiDevice).toBe(true);
      expect(limits.captainHandheld).toBe(true);
      expect(limits.kitchenDisplay).toBe(true);
      expect(limits.inventoryManagement).toBe(true);
      expect(limits.customerCrm).toBe(true);
      expect(limits.onlineOrdering).toBe(true);
      expect(limits.thermalPrinterRouting).toBe(true);
      expect(limits.reportsAnalytics).toBe(true);

      // Check helper isFeatureEntitled
      expect(isFeatureEntitled(entitlements, 'kitchenDisplay')).toBe(true);
      expect(isFeatureEntitled(entitlements, 'captainHandheld')).toBe(true);
      expect(isFeatureEntitled(entitlements, 'inventoryManagement')).toBe(true);
      expect(isFeatureEntitled(entitlements, 'customerCrm')).toBe(true);
      expect(isFeatureEntitled(entitlements, 'onlineOrdering')).toBe(true);
      expect(isFeatureEntitled(entitlements, 'thermalPrinterRouting')).toBe(true);

      // Check UI view entitlement helper
      expect(isViewPlanEntitled(entitlements, 'pos')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'kitchen')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'captain')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'inventory')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'customers')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'reports')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'orders')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'settings')).toBe(true);
      expect(isViewPlanEntitled(entitlements, 'subscription')).toBe(true);
    });
  });

  // TEST 5 — PRO-ONLY FEATURES
  describe('TEST 5 — PRO-ONLY FEATURES REMAIN GATED ON GROWTH', () => {
    it('verifies that Growth does NOT unlock Voice Assistant and Pro features remain gated', async () => {
      const entitlements = await getActivePlanEntitlements(RESTAURANT_GROWTH);

      // Voice Assistant is Pro-only
      expect(entitlements.plan.limits.voiceAssistant).toBe(false);
      expect(isFeatureEntitled(entitlements, 'voiceAssistant')).toBe(false);
      expect(getMinimumRequiredPlan('voiceAssistant')).toBe('Pro');
    });
  });

  // TEST 6 — SERVER-SIDE ENFORCEMENT & IMMUTABILITY
  describe('TEST 6 — SERVER-SIDE & SERVICE-LAYER ENFORCEMENT', () => {
    it('prevents client manipulation or spoofing of plan/features', async () => {
      // Even if a malicious client passes plan="pro" in local object or attempts direct create
      const entitlements = await getActivePlanEntitlements(RESTAURANT_GROWTH);
      expect(entitlements.plan.planId).toBe('growth');

      // Table service directly queries getActivePlanEntitlements from Firestore
      // Verify with Starter restaurant that table #16 is blocked regardless of what client claims
      mockDb[`restaurants/${RESTAURANT_STARTER}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: RESTAURANT_STARTER,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: FIXED_NOW.toISOString(),
        currentPeriodEnd: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        paymentStatus: 'paid',
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString()
      };

      const starterQuota = await checkTableLimit(RESTAURANT_STARTER, 15);
      expect(starterQuota.allowed).toBe(false);
      expect(starterQuota.maxTables).toBe(15);
      expect(starterQuota.planName).toBe('Starter');

      // Verify online ordering gate on Starter
      const mockStarterCart = {
        cartId: 'cart_1',
        restaurantId: RESTAURANT_STARTER,
        items: [
          {
            menuItemId: 'item_1',
            name: 'Paneer Butter Masala',
            price: 250,
            quantity: 1
          }
        ],
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString()
      };
      mockDb[`restaurants/${RESTAURANT_STARTER}/customerCarts/cart_1`] = mockStarterCart;

      await expect(
        submitCustomerOnlineOrder({
          cart: {
            restaurantId: RESTAURANT_STARTER,
            restaurantName: 'Starter Diner',
            publicSlug: 'starter-diner',
            items: [
              {
                cartItemId: 'cart_item_1',
                itemId: 'item_1',
                name: 'Paneer Butter Masala',
                price: 25000,
                quantity: 1
              }
            ],
            subtotal: 25000,
            itemCount: 1
          },
          orderType: 'takeaway',
          customerDetails: {
            name: 'Rahul Verma',
            phone: '9876543210'
          },
          paymentMethod: 'cash'
        })
      ).rejects.toThrow(/Online ordering is not enabled on this restaurant's Starter plan/);
    });
  });

  // TEST 7 — SUBSCRIPTION STATE SOURCE (SINGLE SOURCE OF TRUTH)
  describe('TEST 7 — SUBSCRIPTION STATE SOURCE (FIRESTORE CURRENT IS SOLE AUTHORITY)', () => {
    it('verifies /restaurants/{restaurantId}/subscription/current is the sole authority', async () => {
      // 1. Add fake billing history with 'pro' plan
      const fakeHistory: SubscriptionHistoryRecord = {
        id: 'hist_fake_99',
        restaurantId: RESTAURANT_GROWTH,
        planId: 'pro',
        planName: 'Pro',
        billingCycle: 'annual',
        amount: 99900,
        currency: 'INR',
        status: 'paid',
        paymentReference: 'pay_ref_fake_99',
        provider: 'razorpay',
        timestamp: FIXED_NOW.toISOString(),
        periodStart: FIXED_NOW.toISOString(),
        periodEnd: new Date(FIXED_NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: FIXED_NOW.toISOString()
      };
      mockDb[`restaurants/${RESTAURANT_GROWTH}/subscriptionHistory/hist_fake_99`] = fakeHistory;

      // 2. getActivePlanEntitlements must still return Growth based strictly on current document
      const resolved = await getActivePlanEntitlements(RESTAURANT_GROWTH);
      expect(resolved.plan.planId).toBe('growth');
      expect(resolved.plan.name).toBe('Growth');
      expect(resolved.plan.limits.maxTables).toBe(50);
      expect(resolved.plan.limits.voiceAssistant).toBe(false);
    });
  });

  // TEST 8 — UPGRADE BEHAVIOR
  describe('TEST 8 — UPGRADE BEHAVIOR (STARTER -> GROWTH -> PRO)', () => {
    it('verifies full transition dynamics across all three tiers', async () => {
      const REST_UPGRADE = 'rest_upgrade_flow_test';

      // Stage 1: Starter
      mockDb[`restaurants/${REST_UPGRADE}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_UPGRADE,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: FIXED_NOW.toISOString(),
        currentPeriodEnd: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        paymentStatus: 'paid',
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString()
      };

      let ent = await getActivePlanEntitlements(REST_UPGRADE);
      expect(ent.plan.planId).toBe('starter');
      expect(ent.plan.limits.maxTables).toBe(15);
      expect(ent.plan.limits.maxStaff).toBe(5);
      expect(isViewPlanEntitled(ent, 'kitchen')).toBe(false);

      // Stage 2: Upgrade to Growth
      const upgradeToGrowth = await activatePaidSubscription({
        restaurantId: REST_UPGRADE,
        planId: 'growth',
        billingCycle: 'monthly',
        providerOrderId: 'ord_up_growth',
        paymentId: 'pay_up_growth',
        signature: 'valid_sig_up_growth'
      });
      expect(upgradeToGrowth.success).toBe(true);

      ent = await getActivePlanEntitlements(REST_UPGRADE);
      expect(ent.plan.planId).toBe('growth');
      expect(ent.plan.limits.maxTables).toBe(50);
      expect(ent.plan.limits.maxStaff).toBe(15);
      expect(isViewPlanEntitled(ent, 'kitchen')).toBe(true);
      expect(isViewPlanEntitled(ent, 'captain')).toBe(true);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(false);

      // Stage 3: Upgrade to Pro
      const upgradeToPro = await activatePaidSubscription({
        restaurantId: REST_UPGRADE,
        planId: 'pro',
        billingCycle: 'annual',
        providerOrderId: 'ord_up_pro',
        paymentId: 'pay_up_pro',
        signature: 'valid_sig_up_pro'
      });
      expect(upgradeToPro.success).toBe(true);

      ent = await getActivePlanEntitlements(REST_UPGRADE);
      expect(ent.plan.planId).toBe('pro');
      expect(ent.plan.limits.maxTables).toBe(100);
      expect(ent.plan.limits.maxStaff).toBe(50);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(true);
    });
  });

  // TEST 9 — FAILED/PENDING PAYMENT
  describe('TEST 9 — FAILED / PENDING PAYMENT CANNOT ACTIVATE ENTITLEMENTS', () => {
    it('verifies pending or failed subscriptions do not grant operational access', async () => {
      const REST_PENDING = 'rest_pending_test';

      // 1. Pending payment subscription
      mockDb[`restaurants/${REST_PENDING}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_PENDING,
        planId: 'growth',
        status: 'incomplete',
        billingCycle: 'monthly',
        currentPeriodStart: FIXED_NOW.toISOString(),
        currentPeriodEnd: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        paymentStatus: 'pending',
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString()
      };

      let ent = await getActivePlanEntitlements(REST_PENDING);
      expect(ent.hasActiveSubscription).toBe(false);
      expect(ent.canPerformOperationalActions).toBe(false);

      const tableCheck = await checkTableLimit(REST_PENDING, 2);
      expect(tableCheck.allowed).toBe(false);
      expect(tableCheck.reason).toContain('Subscription is expired or inactive');

      // 2. Failed / past due subscription
      mockDb[`restaurants/${REST_PENDING}/subscription/current`].status = 'past_due';
      mockDb[`restaurants/${REST_PENDING}/subscription/current`].paymentStatus = 'failed';

      ent = await getActivePlanEntitlements(REST_PENDING);
      expect(ent.hasActiveSubscription).toBe(false);
      expect(ent.canPerformOperationalActions).toBe(false);
    });
  });

  // TEST 10 — TENANT ISOLATION
  describe('TEST 10 — MULTI-TENANT SUBSCRIPTION ISOLATION', () => {
    it('verifies Restaurant A subscription does not affect Restaurant B entitlements', async () => {
      const REST_A = 'rest_tenant_alpha';
      const REST_B = 'rest_tenant_beta';

      // Setup Rest A as Pro and Rest B as Starter
      mockDb[`restaurants/${REST_A}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_A,
        planId: 'pro',
        status: 'active',
        billingCycle: 'annual',
        currentPeriodStart: FIXED_NOW.toISOString(),
        currentPeriodEnd: new Date(FIXED_NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        paymentStatus: 'paid',
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString()
      };

      mockDb[`restaurants/${REST_B}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_B,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: FIXED_NOW.toISOString(),
        currentPeriodEnd: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        paymentStatus: 'paid',
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString()
      };

      const entA = await getActivePlanEntitlements(REST_A);
      const entB = await getActivePlanEntitlements(REST_B);

      expect(entA.plan.planId).toBe('pro');
      expect(entA.plan.limits.maxTables).toBe(100);
      expect(entA.plan.limits.maxStaff).toBe(50);
      expect(isFeatureEntitled(entA, 'voiceAssistant')).toBe(true);

      expect(entB.plan.planId).toBe('starter');
      expect(entB.plan.limits.maxTables).toBe(15);
      expect(entB.plan.limits.maxStaff).toBe(5);
      expect(isFeatureEntitled(entB, 'voiceAssistant')).toBe(false);
      expect(isViewPlanEntitled(entB, 'kitchen')).toBe(false);

      // Mutating Rest A cannot affect Rest B
      mockDb[`restaurants/${REST_A}/subscription/current`].status = 'canceled';

      const entAAfter = await getActivePlanEntitlements(REST_A);
      const entBAfter = await getActivePlanEntitlements(REST_B);

      expect(entAAfter.hasActiveSubscription).toBe(false);
      expect(entBAfter.hasActiveSubscription).toBe(true);
      expect(entBAfter.plan.planId).toBe('starter');
    });
  });
});
