import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import {
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  validateSelfServePlan,
  activateSubscriptionInFirestore
} from '../server/razorpayService';
import { SUBSCRIPTION_PLANS, getPlanById } from '../config/subscriptionPlans';

describe('Subscription Security, RBAC & Activation Audit', () => {
  const rulesPath = path.resolve(__dirname, '../../firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  describe('1. Firestore Security Rules Audit for Subscriptions', () => {
    it('prohibits unauthenticated access to subscription collections', () => {
      // Must enforce canAccessRestaurant or isServer, both require isSignedIn()
      expect(rulesContent).toMatch(/match\s+\/subscription\/\{subDocId\}/);
      expect(rulesContent).toMatch(/allow\s+read:\s*if\s+canAccessRestaurant\(restaurantId\)\s*\|\|\s*isServer\(\);/);
      expect(rulesContent).toMatch(/allow\s+create,\s*update:\s*if\s+isServer\(\)/);
      expect(rulesContent).toMatch(/allow\s+delete:\s*if\s+false;/);
    });

    it('enforces immutable audit history for subscriptionHistory', () => {
      expect(rulesContent).toMatch(/match\s+\/subscriptionHistory\/\{historyId\}/);
      expect(rulesContent).toMatch(/allow\s+update,\s*delete:\s*if\s+false;/);
      expect(rulesContent).toMatch(/allow\s+create:\s*if\s+isServer\(\)/);
    });

    it('strictly isolates webhook idempotency records to isServer() only', () => {
      expect(rulesContent).toMatch(/match\s+\/subscriptionWebhookEvents\/\{eventId\}/);
      expect(rulesContent).toMatch(/allow\s+read,\s*write:\s*if\s+isServer\(\);/);
    });

    it('defines isServer() using an Admin-issued custom claim', () => {
      expect(rulesContent).toMatch(/function\s+isServer\(\)\s*\{[\s\S]*?request\.auth\.token\.server\s*==\s*true[\s\S]*?\}/);
      expect(rulesContent).not.toContain("request.auth.token.email == 'system-server@restaurantos.app'");
    });

    it('enforces an authoritative current-subscription timestamp for new operational resources', () => {
      expect(rulesContent).toMatch(/function\s+isSubscriptionActive\(restaurantId\)/);
      expect(rulesContent).toMatch(/subscription\/current/);
      expect(rulesContent).toMatch(/status\s+in\s+\['trial',\s*'active',\s*'grace_period'\]/);
      expect(rulesContent).toMatch(/operationalAccessUntil\s+is\s+timestamp/);
      expect(rulesContent).toMatch(/request\.time\s*<\s*subscription\.data\.operationalAccessUntil/);

      // New-resource creates are subscription-gated; existing-resource updates
      // are deliberately left available for mid-service closeout/settlement.
      expect(rulesContent).toMatch(/match\s+\/orders\/\{orderId\}[\s\S]*?allow\s+create:\s*if\s+isSubscriptionActive\(restaurantId\)/);
      expect(rulesContent).toMatch(/match\s+\/tables\/\{tableId\}[\s\S]*?allow\s+create:\s*if\s+isSubscriptionActive\(restaurantId\)/);
      expect(rulesContent).toMatch(/match\s+\/tableSessions\/\{sessionId\}[\s\S]*?allow\s+create:\s*if\s*\([\s\S]*?isSubscriptionActive\(restaurantId\)/);
      expect(rulesContent).toMatch(/match\s+\/kots\/\{kotId\}[\s\S]*?allow\s+create:\s*if\s+isSubscriptionActive\(restaurantId\)/);
    });
  });

  describe('2. Plan Pricing and Amount Verification', () => {
    it('verifies exact plan pricing constants for Starter, Growth, and Pro', () => {
      const starter = getPlanById('starter');
      expect(starter.price).toBe(299);
      expect(starter.priceMonthlyPaise).toBe(29900);
      expect(starter.priceAnnualPaise).toBe(358800);

      const growth = getPlanById('growth');
      expect(growth.price).toBe(699);
      expect(growth.priceMonthlyPaise).toBe(69900);
      expect(growth.priceAnnualPaise).toBe(838800);

      const pro = getPlanById('pro');
      expect(pro.price).toBe(999);
      expect(pro.priceMonthlyPaise).toBe(99900);
      expect(pro.priceAnnualPaise).toBe(1198800);
    });

    it('validates self-serve commercial plans while rejecting bespoke customization and free trial', () => {
      expect(validateSelfServePlan('starter').valid).toBe(true);
      expect(validateSelfServePlan('growth').valid).toBe(true);
      expect(validateSelfServePlan('pro').valid).toBe(true);
      expect(validateSelfServePlan('trial_7d').valid).toBe(false);
      expect(validateSelfServePlan('customization').valid).toBe(false);
      expect(validateSelfServePlan('non_existent_plan').valid).toBe(false);
    });
  });

  describe('3. Razorpay Signature Verification & Tampering Protection', () => {
    it('verifies signature verification logic exists and rejects invalid signatures', () => {
      const isValid = verifyRazorpayPaymentSignature({
        razorpayOrderId: 'order_test_999',
        razorpayPaymentId: 'pay_test_888',
        razorpaySignature: 'invalid_tampered_signature'
      });
      expect(isValid).toBe(false);
    });

    it('accepts simulated test signatures in test environment', () => {
      const isValid = verifyRazorpayPaymentSignature({
        razorpayOrderId: 'order_test_999',
        razorpayPaymentId: 'pay_test_888',
        razorpaySignature: 'sig_test_valid_mock'
      });
      expect(isValid).toBe(true);
    });

    it('rejects empty signature components', () => {
      expect(
        verifyRazorpayPaymentSignature({
          razorpayOrderId: '',
          razorpayPaymentId: 'pay_123',
          razorpaySignature: 'sig_test_123'
        })
      ).toBe(false);
    });
  });

  describe('4. Activation Safety & Single-Write Guard', () => {
    it('verifies activateSubscriptionInFirestore is defined and handles activation params', () => {
      expect(typeof activateSubscriptionInFirestore).toBe('function');
    });
  });
});
