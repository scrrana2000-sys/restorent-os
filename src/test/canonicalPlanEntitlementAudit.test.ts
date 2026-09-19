import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SUBSCRIPTION_PLANS,
  COMMERCIAL_PLANS,
  getPlanById,
  formatPlanPrice
} from '../config/subscriptionPlans';
import {
  evaluateSubscriptionEntitlements,
  isFeatureEntitled,
  isViewPlanEntitled,
  getMinimumRequiredPlan
} from '../utils/subscriptionEntitlements';
import {
  getActivePlanEntitlements,
  checkTableLimit,
  checkStaffLimit,
  activatePaidSubscription,
  getRestaurantSubscription
} from '../services/subscriptionService';
import { tableService } from '../services/tableService';
import { staffService } from '../services/staffService';
import { RestaurantSubscription, SubscriptionHistoryRecord } from '../types/subscription';

// In-memory Firestore mock store
const mockFirestore: Record<string, any> = {};

vi.mock('../config/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'audit_owner_uid',
      email: 'owner@canonical-audit.com',
      emailVerified: true,
      getIdToken: vi.fn(async () => 'mock-token-audit')
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
        const autoId = 'auto_id_' + Math.random().toString(36).substring(2, 9);
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
      const data = mockFirestore[docRef.path];
      return {
        exists: () => !!data,
        data: () => data,
        id: docRef.id
      };
    }),
    setDoc: vi.fn(async (docRef, data, options) => {
      if (options?.merge && mockFirestore[docRef.path]) {
        mockFirestore[docRef.path] = { ...mockFirestore[docRef.path], ...data };
      } else {
        mockFirestore[docRef.path] = { ...data };
      }
      return Promise.resolve();
    }),
    updateDoc: vi.fn(async (docRef, data) => {
      if (mockFirestore[docRef.path]) {
        mockFirestore[docRef.path] = { ...mockFirestore[docRef.path], ...data };
      } else {
        mockFirestore[docRef.path] = { ...data };
      }
      return Promise.resolve();
    }),
    getDocs: vi.fn(async (colRef) => {
      const prefix = colRef.path + '/';
      const docs = Object.keys(mockFirestore)
        .filter((key) => key.startsWith(prefix) && key.split('/').length === prefix.split('/').length)
        .map((key) => ({
          id: key.replace(prefix, ''),
          data: () => mockFirestore[key],
          exists: () => true
        }));
      return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (callback: (doc: any) => void) => docs.forEach(callback)
      };
    }),
    query: vi.fn((colRef) => colRef),
    where: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    serverTimestamp: vi.fn(() => new Date().toISOString())
  };
});

describe('CANONICAL PLAN ENTITLEMENT & LIMITS AUDIT', () => {
  const AUDIT_NOW = new Date('2026-09-17T12:00:00.000Z');

  beforeEach(() => {
    Object.keys(mockFirestore).forEach((key) => delete mockFirestore[key]);
  });

  // A. CANONICAL PLAN CONFIGURATION & PRICING
  describe('A. CANONICAL PLAN PRICING & LIMITS CONFIGURATION', () => {
    it('verifies EXACT commercial plan order: Starter (₹299) -> Growth (₹699) -> Pro (₹999)', () => {
      expect(COMMERCIAL_PLANS.length).toBe(3);
      expect(COMMERCIAL_PLANS[0].planId).toBe('starter');
      expect(COMMERCIAL_PLANS[1].planId).toBe('growth');
      expect(COMMERCIAL_PLANS[2].planId).toBe('pro');

      // Starter
      const starter = COMMERCIAL_PLANS[0];
      expect(starter.price).toBe(299);
      expect(starter.priceMonthlyPaise).toBe(29900);
      expect(starter.currency).toBe('INR');
      expect(starter.currencySymbol).toBe('₹');
      expect(formatPlanPrice(starter.priceMonthlyPaise)).toBe('₹299');

      // Growth
      const growth = COMMERCIAL_PLANS[1];
      expect(growth.price).toBe(699);
      expect(growth.priceMonthlyPaise).toBe(69900);
      expect(growth.currency).toBe('INR');
      expect(growth.currencySymbol).toBe('₹');
      expect(formatPlanPrice(growth.priceMonthlyPaise)).toBe('₹699');

      // Pro
      const pro = COMMERCIAL_PLANS[2];
      expect(pro.price).toBe(999);
      expect(pro.priceMonthlyPaise).toBe(99900);
      expect(pro.currency).toBe('INR');
      expect(pro.currencySymbol).toBe('₹');
      expect(formatPlanPrice(pro.priceMonthlyPaise)).toBe('₹999');

      // Verify no plan is ₹1499
      COMMERCIAL_PLANS.forEach((plan) => {
        expect(plan.price).not.toBe(1499);
        expect(plan.priceMonthlyPaise).not.toBe(149900);
      });
    });

    it('verifies EXACT canonical limits: Starter (15/5), Growth (50/15), Pro (100/50 - NOT unlimited)', () => {
      const starter = getPlanById('starter');
      expect(starter.limits.maxTables).toBe(15);
      expect(starter.limits.maxStaff).toBe(5);

      const growth = getPlanById('growth');
      expect(growth.limits.maxTables).toBe(50);
      expect(growth.limits.maxStaff).toBe(15);

      const pro = getPlanById('pro');
      expect(pro.limits.maxTables).toBe(100);
      expect(pro.limits.maxStaff).toBe(50);

      // Verify Pro limits are concrete finite numbers
      expect(typeof pro.limits.maxTables).toBe('number');
      expect(typeof pro.limits.maxStaff).toBe('number');
      expect(pro.limits.maxTables).toBe(100);
      expect(pro.limits.maxStaff).toBe(50);
    });
  });

  // B. TABLE QUOTA BOUNDARY ENFORCEMENT
  describe('B. TABLE QUOTA BOUNDARY ENFORCEMENT (STARTER: 15, GROWTH: 50, PRO: 100)', () => {
    it('Starter allows up to 15 tables and strictly BLOCKS the 16th table', async () => {
      const REST_STARTER = 'rest_starter_tbl_audit';
      mockFirestore[`restaurants/${REST_STARTER}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_STARTER,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // 0 to 14 existing tables: quota check allowed
      const check14 = await checkTableLimit(REST_STARTER, 14);
      expect(check14.allowed).toBe(true);
      expect(check14.maxTables).toBe(15);

      // 15 existing tables: quota check blocked for new table
      const check15 = await checkTableLimit(REST_STARTER, 15);
      expect(check15.allowed).toBe(false);
      expect(check15.maxTables).toBe(15);
      expect(check15.reason).toContain('Table limit reached (15/15 on Starter plan)');

      // Pre-seed 15 tables in Firestore
      for (let i = 1; i <= 15; i++) {
        mockFirestore[`restaurants/${REST_STARTER}/tables/t_${i}`] = {
          id: `t_${i}`,
          restaurantId: REST_STARTER,
          name: `Table ${i}`,
          tableNumber: `T-${i}`,
          capacity: 4,
          floorOrArea: 'Main',
          isActive: true
        };
      }

      // Attempting to create the 16th table via tableService must throw
      await expect(
        tableService.createTable(
          REST_STARTER,
          {
            name: 'Table 16',
            tableNumber: 'T-16',
            capacity: 4,
            floorOrArea: 'Main',
            isActive: true,
            sortOrder: 16
          },
          'audit_owner_uid'
        )
      ).rejects.toThrow(/Table limit reached/);
    });

    it('Growth allows up to 50 tables and strictly BLOCKS the 51st table', async () => {
      const REST_GROWTH = 'rest_growth_tbl_audit';
      mockFirestore[`restaurants/${REST_GROWTH}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_GROWTH,
        planId: 'growth',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // 49 existing tables: allowed
      const check49 = await checkTableLimit(REST_GROWTH, 49);
      expect(check49.allowed).toBe(true);
      expect(check49.maxTables).toBe(50);

      // 50 existing tables: blocked
      const check50 = await checkTableLimit(REST_GROWTH, 50);
      expect(check50.allowed).toBe(false);
      expect(check50.maxTables).toBe(50);
      expect(check50.reason).toContain('Table limit reached (50/50 on Growth plan)');

      // Pre-seed 50 tables
      for (let i = 1; i <= 50; i++) {
        mockFirestore[`restaurants/${REST_GROWTH}/tables/t_${i}`] = {
          id: `t_${i}`,
          restaurantId: REST_GROWTH,
          name: `Table ${i}`,
          tableNumber: `T-${i}`,
          capacity: 4,
          floorOrArea: 'Main',
          isActive: true
        };
      }

      // Attempting to create the 51st table must throw
      await expect(
        tableService.createTable(
          REST_GROWTH,
          {
            name: 'Table 51',
            tableNumber: 'T-51',
            capacity: 4,
            floorOrArea: 'Main',
            isActive: true,
            sortOrder: 51
          },
          'audit_owner_uid'
        )
      ).rejects.toThrow(/Table limit reached/);
    });

    it('Pro allows up to 100 tables and strictly BLOCKS the 101st table (NOT unlimited)', async () => {
      const REST_PRO = 'rest_pro_tbl_audit';
      mockFirestore[`restaurants/${REST_PRO}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_PRO,
        planId: 'pro',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // 99 existing tables: allowed
      const check99 = await checkTableLimit(REST_PRO, 99);
      expect(check99.allowed).toBe(true);
      expect(check99.maxTables).toBe(100);

      // 100 existing tables: blocked
      const check100 = await checkTableLimit(REST_PRO, 100);
      expect(check100.allowed).toBe(false);
      expect(check100.maxTables).toBe(100);
      expect(check100.reason).toContain('Table limit reached (100/100 on Pro plan)');

      // Pre-seed 100 tables
      for (let i = 1; i <= 100; i++) {
        mockFirestore[`restaurants/${REST_PRO}/tables/t_${i}`] = {
          id: `t_${i}`,
          restaurantId: REST_PRO,
          name: `Table ${i}`,
          tableNumber: `T-${i}`,
          capacity: 4,
          floorOrArea: 'Main',
          isActive: true
        };
      }

      // Attempting to create the 101st table must throw
      await expect(
        tableService.createTable(
          REST_PRO,
          {
            name: 'Table 101',
            tableNumber: 'T-101',
            capacity: 4,
            floorOrArea: 'Main',
            isActive: true,
            sortOrder: 101
          },
          'audit_owner_uid'
        )
      ).rejects.toThrow(/Table limit reached/);
    });
  });

  // C. STAFF QUOTA BOUNDARY ENFORCEMENT
  describe('C. STAFF QUOTA BOUNDARY ENFORCEMENT (STARTER: 5, GROWTH: 15, PRO: 50)', () => {
    it('Starter allows up to 5 staff and strictly BLOCKS the 6th staff member', async () => {
      const REST_STARTER = 'rest_starter_staff_audit';
      mockFirestore[`restaurants/${REST_STARTER}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_STARTER,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // 4 existing staff: allowed
      const check4 = await checkStaffLimit(REST_STARTER, 4);
      expect(check4.allowed).toBe(true);
      expect(check4.maxStaff).toBe(5);

      // 5 existing staff: blocked
      const check5 = await checkStaffLimit(REST_STARTER, 5);
      expect(check5.allowed).toBe(false);
      expect(check5.maxStaff).toBe(5);
      expect(check5.reason).toContain('Staff limit reached (5/5 on Starter plan)');

      // Pre-seed 5 staff in Firestore
      for (let i = 1; i <= 5; i++) {
        mockFirestore[`restaurants/${REST_STARTER}/members/s_${i}`] = {
          id: `s_${i}`,
          restaurantId: REST_STARTER,
          email: `staff${i}@startertest.com`,
          displayName: `Staff ${i}`,
          role: 'waiter',
          status: 'active'
        };
      }

      // Attempting to add 6th staff must throw
      await expect(
        staffService.addStaffMember(REST_STARTER, {
          email: 'staff6@startertest.com',
          displayName: 'Staff 6',
          role: 'kitchen'
        })
      ).rejects.toThrow(/Staff limit reached/);
    });

    it('Growth allows up to 15 staff and strictly BLOCKS the 16th staff member', async () => {
      const REST_GROWTH = 'rest_growth_staff_audit';
      mockFirestore[`restaurants/${REST_GROWTH}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_GROWTH,
        planId: 'growth',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // 14 existing staff: allowed
      const check14 = await checkStaffLimit(REST_GROWTH, 14);
      expect(check14.allowed).toBe(true);
      expect(check14.maxStaff).toBe(15);

      // 15 existing staff: blocked
      const check15 = await checkStaffLimit(REST_GROWTH, 15);
      expect(check15.allowed).toBe(false);
      expect(check15.maxStaff).toBe(15);
      expect(check15.reason).toContain('Staff limit reached (15/15 on Growth plan)');

      // Pre-seed 15 staff
      for (let i = 1; i <= 15; i++) {
        mockFirestore[`restaurants/${REST_GROWTH}/members/s_${i}`] = {
          id: `s_${i}`,
          restaurantId: REST_GROWTH,
          email: `staff${i}@growthtest.com`,
          displayName: `Staff ${i}`,
          role: 'waiter',
          status: 'active'
        };
      }

      // Attempting to add 16th staff must throw
      await expect(
        staffService.addStaffMember(REST_GROWTH, {
          email: 'staff16@growthtest.com',
          displayName: 'Staff 16',
          role: 'kitchen'
        })
      ).rejects.toThrow(/Staff limit reached/);
    });

    it('Pro allows up to 50 staff and strictly BLOCKS the 51st staff member (NOT unlimited)', async () => {
      const REST_PRO = 'rest_pro_staff_audit';
      mockFirestore[`restaurants/${REST_PRO}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_PRO,
        planId: 'pro',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // 49 existing staff: allowed
      const check49 = await checkStaffLimit(REST_PRO, 49);
      expect(check49.allowed).toBe(true);
      expect(check49.maxStaff).toBe(50);

      // 50 existing staff: blocked
      const check50 = await checkStaffLimit(REST_PRO, 50);
      expect(check50.allowed).toBe(false);
      expect(check50.maxStaff).toBe(50);
      expect(check50.reason).toContain('Staff limit reached (50/50 on Pro plan)');

      // Pre-seed 50 staff
      for (let i = 1; i <= 50; i++) {
        mockFirestore[`restaurants/${REST_PRO}/members/s_${i}`] = {
          id: `s_${i}`,
          restaurantId: REST_PRO,
          email: `staff${i}@protest.com`,
          displayName: `Staff ${i}`,
          role: 'waiter',
          status: 'active'
        };
      }

      // Attempting to add 51st staff must throw
      await expect(
        staffService.addStaffMember(REST_PRO, {
          email: 'staff51@protest.com',
          displayName: 'Staff 51',
          role: 'kitchen'
        })
      ).rejects.toThrow(/Staff limit reached/);
    });
  });

  // D. FEATURE MATRIX & VOICE ASSISTANT VERIFICATION
  describe('D. FEATURE MATRIX & VOICE ASSISTANT VERIFICATION', () => {
    it('verifies Voice Assistant is strictly LOCKED on Starter & Growth, and UNLOCKED on Pro', () => {
      const starterPlan = getPlanById('starter');
      const growthPlan = getPlanById('growth');
      const proPlan = getPlanById('pro');

      expect(starterPlan.limits.voiceAssistant).toBe(false);
      expect(growthPlan.limits.voiceAssistant).toBe(false);
      expect(proPlan.limits.voiceAssistant).toBe(true);

      const starterEnt = evaluateSubscriptionEntitlements({
        subscriptionId: 'current',
        restaurantId: 'rest_test',
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        trialStartedAt: AUDIT_NOW.toISOString(),
        trialEndsAt: AUDIT_NOW.toISOString(),
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        provider: 'mock_gateway',
        autoRenew: false,
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      });
      expect(isFeatureEntitled(starterEnt, 'voiceAssistant')).toBe(false);

      const growthEnt = evaluateSubscriptionEntitlements({
        subscriptionId: 'current',
        restaurantId: 'rest_test',
        planId: 'growth',
        status: 'active',
        billingCycle: 'monthly',
        trialStartedAt: AUDIT_NOW.toISOString(),
        trialEndsAt: AUDIT_NOW.toISOString(),
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        provider: 'mock_gateway',
        autoRenew: false,
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      });
      expect(isFeatureEntitled(growthEnt, 'voiceAssistant')).toBe(false);

      const proEnt = evaluateSubscriptionEntitlements({
        subscriptionId: 'current',
        restaurantId: 'rest_test',
        planId: 'pro',
        status: 'active',
        billingCycle: 'monthly',
        trialStartedAt: AUDIT_NOW.toISOString(),
        trialEndsAt: AUDIT_NOW.toISOString(),
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        provider: 'mock_gateway',
        autoRenew: false,
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      });
      expect(isFeatureEntitled(proEnt, 'voiceAssistant')).toBe(true);
    });

    it('verifies Growth feature entitlement matrix: KDS, CRM, Online Ordering, Inventory are unlocked on Growth & Pro, locked on Starter', () => {
      const starterEnt = evaluateSubscriptionEntitlements({
        subscriptionId: 'current',
        restaurantId: 'rest_test',
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        trialStartedAt: AUDIT_NOW.toISOString(),
        trialEndsAt: AUDIT_NOW.toISOString(),
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        provider: 'mock_gateway',
        autoRenew: false,
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      });
      expect(isFeatureEntitled(starterEnt, 'kitchenDisplay')).toBe(false);
      expect(isFeatureEntitled(starterEnt, 'captainHandheld')).toBe(false);
      expect(isFeatureEntitled(starterEnt, 'customerCrm')).toBe(false);
      expect(isFeatureEntitled(starterEnt, 'onlineOrdering')).toBe(false);
      expect(isFeatureEntitled(starterEnt, 'inventoryManagement')).toBe(false);
      expect(isFeatureEntitled(starterEnt, 'reportsAnalytics')).toBe(true);

      const growthEnt = evaluateSubscriptionEntitlements({
        subscriptionId: 'current',
        restaurantId: 'rest_test',
        planId: 'growth',
        status: 'active',
        billingCycle: 'monthly',
        trialStartedAt: AUDIT_NOW.toISOString(),
        trialEndsAt: AUDIT_NOW.toISOString(),
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        provider: 'mock_gateway',
        autoRenew: false,
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      });
      expect(isFeatureEntitled(growthEnt, 'kitchenDisplay')).toBe(true);
      expect(isFeatureEntitled(growthEnt, 'captainHandheld')).toBe(true);
      expect(isFeatureEntitled(growthEnt, 'customerCrm')).toBe(true);
      expect(isFeatureEntitled(growthEnt, 'onlineOrdering')).toBe(true);
      expect(isFeatureEntitled(growthEnt, 'inventoryManagement')).toBe(true);
      expect(isFeatureEntitled(growthEnt, 'reportsAnalytics')).toBe(true);
      expect(isFeatureEntitled(growthEnt, 'voiceAssistant')).toBe(false);
    });
  });

  // E. UPGRADE & DOWNGRADE TRANSITION DYNAMICS
  describe('E. UPGRADE & DOWNGRADE TRANSITION DYNAMICS', () => {
    it('verifies seamless plan transitions (Starter -> Growth -> Pro -> Growth -> Starter) with precise limit adjustments', async () => {
      const REST_TRANS = 'rest_transition_audit';

      // 1. Initial State: Starter
      mockFirestore[`restaurants/${REST_TRANS}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_TRANS,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      let ent = await getActivePlanEntitlements(REST_TRANS);
      expect(ent.plan.planId).toBe('starter');
      expect(ent.plan.limits.maxTables).toBe(15);
      expect(ent.plan.limits.maxStaff).toBe(5);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(false);

      // 2. Upgrade to Growth
      await activatePaidSubscription({
        restaurantId: REST_TRANS,
        planId: 'growth',
        billingCycle: 'monthly',
        providerOrderId: 'ord_growth_up',
        paymentId: 'pay_growth_up',
        signature: 'sig_growth_up'
      });

      ent = await getActivePlanEntitlements(REST_TRANS);
      expect(ent.plan.planId).toBe('growth');
      expect(ent.plan.limits.maxTables).toBe(50);
      expect(ent.plan.limits.maxStaff).toBe(15);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(false);
      expect(isFeatureEntitled(ent, 'kitchenDisplay')).toBe(true);

      // 3. Upgrade to Pro
      await activatePaidSubscription({
        restaurantId: REST_TRANS,
        planId: 'pro',
        billingCycle: 'monthly',
        providerOrderId: 'ord_pro_up',
        paymentId: 'pay_pro_up',
        signature: 'sig_pro_up'
      });

      ent = await getActivePlanEntitlements(REST_TRANS);
      expect(ent.plan.planId).toBe('pro');
      expect(ent.plan.limits.maxTables).toBe(100);
      expect(ent.plan.limits.maxStaff).toBe(50);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(true);

      // 4. Downgrade to Growth
      await activatePaidSubscription({
        restaurantId: REST_TRANS,
        planId: 'growth',
        billingCycle: 'monthly',
        providerOrderId: 'ord_growth_down',
        paymentId: 'pay_growth_down',
        signature: 'sig_growth_down'
      });

      ent = await getActivePlanEntitlements(REST_TRANS);
      expect(ent.plan.planId).toBe('growth');
      expect(ent.plan.limits.maxTables).toBe(50);
      expect(ent.plan.limits.maxStaff).toBe(15);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(false);

      // 5. Downgrade to Starter
      await activatePaidSubscription({
        restaurantId: REST_TRANS,
        planId: 'starter',
        billingCycle: 'monthly',
        providerOrderId: 'ord_starter_down',
        paymentId: 'pay_starter_down',
        signature: 'sig_starter_down'
      });

      ent = await getActivePlanEntitlements(REST_TRANS);
      expect(ent.plan.planId).toBe('starter');
      expect(ent.plan.limits.maxTables).toBe(15);
      expect(ent.plan.limits.maxStaff).toBe(5);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(false);
    });
  });

  // F. PAYMENT STATE & INACTIVE SUBSCRIPTIONS DEFENSE
  describe('F. PAYMENT STATE & INACTIVE SUBSCRIPTIONS DEFENSE', () => {
    it('verifies pending, failed, past_due, canceled, and expired subscriptions CANNOT grant operational entitlements', async () => {
      const REST_INACTIVE = 'rest_inactive_audit';

      const invalidStatuses: Array<{ status: any; paymentStatus: any }> = [
        { status: 'incomplete', paymentStatus: 'pending' },
        { status: 'past_due', paymentStatus: 'failed' },
        { status: 'canceled', paymentStatus: 'paid' },
        { status: 'expired', paymentStatus: 'paid' }
      ];

      for (const item of invalidStatuses) {
        mockFirestore[`restaurants/${REST_INACTIVE}/subscription/current`] = {
          subscriptionId: 'current',
          restaurantId: REST_INACTIVE,
          planId: 'pro',
          status: item.status,
          billingCycle: 'monthly',
          currentPeriodStart: AUDIT_NOW.toISOString(),
          currentPeriodEnd: new Date(AUDIT_NOW.getTime() - 1000).toISOString(),
          paymentStatus: item.paymentStatus,
          createdAt: AUDIT_NOW.toISOString(),
          updatedAt: AUDIT_NOW.toISOString()
        };

        const ent = await getActivePlanEntitlements(REST_INACTIVE);
        expect(ent.hasActiveSubscription).toBe(false);
        expect(ent.canPerformOperationalActions).toBe(false);

        const tableCheck = await checkTableLimit(REST_INACTIVE, 0);
        expect(tableCheck.allowed).toBe(false);
        expect(tableCheck.reason).toContain('Subscription is expired or inactive');

        const staffCheck = await checkStaffLimit(REST_INACTIVE, 0);
        expect(staffCheck.allowed).toBe(false);
        expect(staffCheck.reason).toContain('Subscription is expired or inactive');
      }
    });
  });

  // G. SINGLE SOURCE OF TRUTH & AUTHORITY ISOLATION
  describe('G. SINGLE SOURCE OF TRUTH & AUTHORITY ISOLATION', () => {
    it('verifies /restaurants/{id}/subscription/current is the sole authority and billing history cannot determine current plan', async () => {
      const REST_SSOT = 'rest_ssot_audit';

      // Current document is Starter
      mockFirestore[`restaurants/${REST_SSOT}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_SSOT,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // Injected fake historical record saying 'pro'
      const fakeHistory: SubscriptionHistoryRecord = {
        id: 'hist_fake_pro',
        restaurantId: REST_SSOT,
        planId: 'pro',
        planName: 'Pro',
        billingCycle: 'monthly',
        amount: 99900,
        currency: 'INR',
        status: 'paid',
        paymentReference: 'pay_fake_pro_999',
        provider: 'razorpay',
        timestamp: AUDIT_NOW.toISOString(),
        periodStart: AUDIT_NOW.toISOString(),
        periodEnd: new Date(AUDIT_NOW.getTime() + 365 * 86400000).toISOString(),
        createdAt: AUDIT_NOW.toISOString()
      };
      mockFirestore[`restaurants/${REST_SSOT}/subscriptionHistory/hist_fake_pro`] = fakeHistory;

      // Entitlements must resolve strictly to Starter (15/5), NOT Pro
      const ent = await getActivePlanEntitlements(REST_SSOT);
      expect(ent.plan.planId).toBe('starter');
      expect(ent.plan.limits.maxTables).toBe(15);
      expect(ent.plan.limits.maxStaff).toBe(5);
      expect(isFeatureEntitled(ent, 'voiceAssistant')).toBe(false);
    });
  });

  // H. MULTI-TENANT SUBSCRIPTION ISOLATION
  describe('H. MULTI-TENANT SUBSCRIPTION ISOLATION', () => {
    it('verifies Restaurant A on Pro (100/50) does not leak or grant entitlements to Restaurant B on Starter (15/5)', async () => {
      const REST_TENANT_A = 'rest_tenant_pro_100';
      const REST_TENANT_B = 'rest_tenant_starter_15';

      // Restaurant A on Pro
      mockFirestore[`restaurants/${REST_TENANT_A}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_TENANT_A,
        planId: 'pro',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      // Restaurant B on Starter
      mockFirestore[`restaurants/${REST_TENANT_B}/subscription/current`] = {
        subscriptionId: 'current',
        restaurantId: REST_TENANT_B,
        planId: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        currentPeriodStart: AUDIT_NOW.toISOString(),
        currentPeriodEnd: new Date(AUDIT_NOW.getTime() + 30 * 86400000).toISOString(),
        paymentStatus: 'paid',
        createdAt: AUDIT_NOW.toISOString(),
        updatedAt: AUDIT_NOW.toISOString()
      };

      const entA = await getActivePlanEntitlements(REST_TENANT_A);
      const entB = await getActivePlanEntitlements(REST_TENANT_B);

      // Verify A has Pro limits
      expect(entA.plan.planId).toBe('pro');
      expect(entA.plan.limits.maxTables).toBe(100);
      expect(entA.plan.limits.maxStaff).toBe(50);
      expect(isFeatureEntitled(entA, 'voiceAssistant')).toBe(true);

      // Verify B has Starter limits
      expect(entB.plan.planId).toBe('starter');
      expect(entB.plan.limits.maxTables).toBe(15);
      expect(entB.plan.limits.maxStaff).toBe(5);
      expect(isFeatureEntitled(entB, 'voiceAssistant')).toBe(false);

      // Verify Table limit check for B with 15 tables is blocked
      const checkB = await checkTableLimit(REST_TENANT_B, 15);
      expect(checkB.allowed).toBe(false);
      expect(checkB.maxTables).toBe(15);

      // Verify Table limit check for A with 15 tables is allowed
      const checkA = await checkTableLimit(REST_TENANT_A, 15);
      expect(checkA.allowed).toBe(true);
      expect(checkA.maxTables).toBe(100);
    });
  });
});
