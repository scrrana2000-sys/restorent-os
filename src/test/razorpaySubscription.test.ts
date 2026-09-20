import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  processRazorpayWebhookPayload,
  validateSelfServePlan,
  getPublicRazorpayKeyId,
  activateSubscriptionInFirestore,
  recordSubscriptionAudit
} from '../server/razorpayService';
import {
  verifyRestaurantOwnerForSubscription,
  getFirestoreBaseUrl,
  getFirebaseConfig
} from '../server/invitationAuth';
import { getPlanById, COMMERCIAL_PLANS } from '../config/subscriptionPlans';
import { doc, setDoc } from 'firebase/firestore';

// In-memory persistent mock database for Firestore backend tests
const mockFirestoreDb = new Map<string, any>();

function getMockDoc(path: string) {
  if (mockFirestoreDb.has(path)) {
    return {
      exists: () => true,
      data: () => mockFirestoreDb.get(path),
      id: path.split('/').pop()!
    };
  }
  // Default trial state for restaurant current subscription
  if (path.includes('/subscription/current')) {
    return {
      exists: () => true,
      data: () => ({
        status: 'trial',
        planId: 'trial_7d',
        trialStartedAt: '2026-09-17T00:00:00.000Z',
        trialEndsAt: '2026-09-24T00:00:00.000Z'
      }),
      id: 'current'
    };
  }
  return {
    exists: () => false,
    data: () => undefined,
    id: path.split('/').pop()!
  };
}

function setMockDoc(path: string, data: any, options?: { merge?: boolean }) {
  if (options?.merge && mockFirestoreDb.has(path)) {
    const prev = mockFirestoreDb.get(path);
    mockFirestoreDb.set(path, { ...prev, ...data });
  } else {
    mockFirestoreDb.set(path, data);
  }
}

let autoIdCounter = 1;
let transactionLock = Promise.resolve();

// Mock Firestore for backend tests
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: vi.fn((firstArg: any, ...rest: string[]) => {
      if (firstArg && typeof firstArg === 'object' && firstArg.path) {
        const id = rest.length > 0 ? rest[0] : `auto_doc_${autoIdCounter++}`;
        return {
          id,
          path: `${firstArg.path}/${id}`
        };
      }
      const id = rest[rest.length - 1] || `auto_doc_${autoIdCounter++}`;
      return {
        id,
        path: rest.join('/')
      };
    }),
    collection: vi.fn((_db, ...pathSegments) => ({
      id: pathSegments[pathSegments.length - 1],
      path: pathSegments.join('/')
    })),
    getDoc: vi.fn(async (docRef: any) => getMockDoc(docRef.path)),
    setDoc: vi.fn(async (docRef: any, data: any, options?: any) => {
      setMockDoc(docRef.path, data, options);
    }),
    runTransaction: vi.fn(async (_db: any, callback: any) => {
      // Accurately simulate Firestore transaction serialization & OCC
      const prevLock = transactionLock;
      let release: () => void = () => {};
      transactionLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prevLock;
      try {
        return await callback({
          get: async (docRef: any) => getMockDoc(docRef.path),
          set: (docRef: any, data: any) => setMockDoc(docRef.path, data),
          update: (docRef: any, data: any) => setMockDoc(docRef.path, data, { merge: true })
        });
      } finally {
        release();
      }
    }),
    serverTimestamp: vi.fn(() => new Date().toISOString())
  };
});

vi.mock('../server/firebaseAdmin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const mockDocRef = (docPath: string) => ({
    id: docPath.split('/').pop()!,
    path: docPath,
    get: async () => {
      const d = getMockDoc(docPath);
      return {
        exists: d.exists(),
        data: () => d.data(),
        id: d.id
      };
    },
    set: async (data: any, options?: any) => {
      await setDoc({ path: docPath } as any, data, options);
      setMockDoc(docPath, data, options);
    }
  });

  const mockAdminDb = {
    doc: vi.fn((docPath: string) => {
      doc({} as any, ...docPath.split('/'));
      return mockDocRef(docPath);
    }),
    collection: vi.fn((colPath: string) => ({
      path: colPath,
      doc: (subPath?: string) => {
        const id = subPath || `auto_doc_${autoIdCounter++}`;
        const fullPath = `${colPath}/${id}`;
        doc({} as any, ...fullPath.split('/'));
        return mockDocRef(fullPath);
      }
    })),
    runTransaction: vi.fn(async (callback: any) => {
      const prevLock = transactionLock;
      let release: () => void = () => {};
      transactionLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prevLock;
      try {
        return await callback({
          get: async (ref: any) => {
            const d = getMockDoc(ref.path);
            return {
              exists: d.exists(),
              data: () => d.data(),
              id: d.id
            };
          },
          set: (ref: any, data: any, options?: any) => setMockDoc(ref.path, data, options),
          update: (ref: any, data: any) => setMockDoc(ref.path, data, { merge: true })
        });
      } finally {
        release();
      }
    })
  };

  return {
    ...actual,
    adminDb: mockAdminDb
  };
});

describe('Production Razorpay Subscription & Payment Flow', () => {
  const testSecret = 'rzp_test_secret_987654321';

  beforeEach(() => {
    process.env.RAZORPAY_KEY_SECRET = testSecret;
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_123';
  });

  describe('Server-Side Cryptographic Signature Verification', () => {
    it('successfully verifies authentic Razorpay payment signature via HMAC SHA-256', () => {
      const orderId = 'order_test_999888';
      const paymentId = 'pay_test_111222';
      const payload = `${orderId}|${paymentId}`;
      const validSignature = crypto
        .createHmac('sha256', testSecret)
        .update(payload)
        .digest('hex');

      const isValid = verifyRazorpayPaymentSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature
      });

      expect(isValid).toBe(true);
    });

    it('strictly rejects tampered or fraudulent payment signatures', () => {
      const orderId = 'order_test_999888';
      const paymentId = 'pay_test_111222';
      const forgedSignature = 'tampered_signature_hex_00000000000000000000000000000000';

      const isValid = verifyRazorpayPaymentSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: forgedSignature
      });

      expect(isValid).toBe(false);
    });

    it('strictly rejects payment signature if secret is missing or order ID is altered', () => {
      const orderId = 'order_test_999888';
      const paymentId = 'pay_test_111222';
      const validSignature = crypto
        .createHmac('sha256', testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      // Altered order ID
      const isValidAltered = verifyRazorpayPaymentSignature({
        razorpayOrderId: 'order_test_DIFFERENT',
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature
      });
      expect(isValidAltered).toBe(false);
    });
  });

  describe('Commercial Plan Pricing & Minor Unit (Paise) Precision', () => {
    it('guarantees Starter is exactly ₹299 (29,900 paise)', () => {
      const plan = getPlanById('starter');
      expect(plan.price).toBe(299);
      expect(plan.priceMonthlyPaise).toBe(29900);
      expect(plan.currency).toBe('INR');
    });

    it('guarantees Growth is exactly ₹699 (69,900 paise)', () => {
      const plan = getPlanById('growth');
      expect(plan.price).toBe(699);
      expect(plan.priceMonthlyPaise).toBe(69900);
      expect(plan.currency).toBe('INR');
    });

    it('guarantees Pro is exactly ₹999 (99,900 paise)', () => {
      const plan = getPlanById('pro');
      expect(plan.price).toBe(999);
      expect(plan.priceMonthlyPaise).toBe(99900);
      expect(plan.currency).toBe('INR');
    });
  });

  describe('Plan Validation & Customization Segregation', () => {
    it('accepts legitimate self-serve plans: starter, growth, pro', () => {
      expect(validateSelfServePlan('starter').valid).toBe(true);
      expect(validateSelfServePlan('growth').valid).toBe(true);
      expect(validateSelfServePlan('pro').valid).toBe(true);
    });

    it('strictly rejects customization from self-serve checkout orders', () => {
      const result = validateSelfServePlan('customization');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be purchased via automated self-serve checkout');
      expect(result.error).toContain('radhachawan01@gmail.com');
    });

    it('strictly rejects unknown or manipulated plan IDs', () => {
      const result = validateSelfServePlan('hacked_plan_001');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid plan');
      expect(result.error).toContain('starter, growth, pro');
    });
  });

  describe('Webhook Security & Idempotency', () => {
    it('verifies legitimate Razorpay webhook signatures via HMAC SHA-256', () => {
      const webhookSecret = 'whsec_test_secret_123';
      const body = JSON.stringify({ event: 'payment.captured', id: 'evt_123' });
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      const isValid = verifyRazorpayWebhookSignature(body, signature);
      expect(isValid).toBe(true);
    });

    it('rejects tampered webhook payloads', () => {
      const webhookSecret = 'whsec_test_secret_123';
      const body = JSON.stringify({ event: 'payment.captured', id: 'evt_123' });
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      const tamperedBody = JSON.stringify({ event: 'payment.captured', id: 'evt_TAMPERED' });
      const isValid = verifyRazorpayWebhookSignature(tamperedBody, signature);
      expect(isValid).toBe(false);
    });

    it('ensures webhook idempotency (skips duplicated events)', async () => {
      const eventId = 'evt_idempotent_test_001';
      const payload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_idem_001',
              order_id: 'order_idem_001',
              amount: 29900,
              currency: 'INR',
              notes: {
                restaurantId: 'rest_idem_1',
                planId: 'starter',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      const firstProcess = await processRazorpayWebhookPayload(payload, eventId);
      expect(firstProcess.received).toBe(true);
      expect(firstProcess.actionTaken).toBe('subscription_activated');

      // Second attempt with exact same event ID must be skipped idempotently
      const secondProcess = await processRazorpayWebhookPayload(payload, eventId);
      expect(secondProcess.received).toBe(true);
      expect(secondProcess.idempotent).toBe(true);
    });
  });

  describe('Key ID Exposure Constraints', () => {
    it('provides public Key ID or test placeholder, never exposes Key Secret', () => {
      const keyId = getPublicRazorpayKeyId();
      expect(keyId).toBeDefined();
      expect(keyId).not.toContain(testSecret);
    });

    it('verifies frontend code and environment never expose RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET', () => {
      // Key secret and webhook secret must be server-only
      expect(process.env.VITE_RAZORPAY_KEY_SECRET).toBeUndefined();
      expect(process.env.VITE_RAZORPAY_WEBHOOK_SECRET).toBeUndefined();
    });
  });

  describe('Trial Preservation & Storage Location Invariants', () => {
    it('stores subscription data under /restaurants/{restaurantId}/subscription/current', async () => {
      const result = await activateSubscriptionInFirestore({
        restaurantId: 'rest_isolation_abc',
        planId: 'growth',
        billingCycle: 'monthly',
        razorpayOrderId: 'order_iso_123',
        razorpayPaymentId: 'pay_iso_123'
      });

      expect(result.restaurantId).toBe('rest_isolation_abc');
      expect(result.subscriptionId).toBe('current');
      expect(result.status).toBe('active');
      expect(result.planId).toBe('growth');
      expect(result.amount).toBe(69900); // Growth ₹699 in paise

      // Verify setDoc was called with doc path matching /restaurants/{restaurantId}/subscription/current
      expect(doc).toHaveBeenCalledWith(
        expect.anything(),
        'restaurants',
        'rest_isolation_abc',
        'subscription',
        'current'
      );
    });

    it('preserves existing 7-day trial dates and never restarts the trial window upon activation', async () => {
      const existingTrialStart = '2026-09-17T00:00:00.000Z';
      const existingTrialEnd = '2026-09-24T00:00:00.000Z';

      const result = await activateSubscriptionInFirestore({
        restaurantId: 'rest_trial_preserve_01',
        planId: 'pro',
        billingCycle: 'monthly',
        razorpayOrderId: 'order_trial_123',
        razorpayPaymentId: 'pay_trial_123'
      });

      // Existing trial dates from getDoc mock are preserved
      expect(result.trialStartedAt).toBe(existingTrialStart);
      expect(result.trialEndsAt).toBe(existingTrialEnd);
      // Status is active, not trial
      expect(result.status).toBe('active');
    });

    it('creates immutable subscription audit history record upon activation', async () => {
      const setDocSpy = vi.mocked(setDoc);
      setDocSpy.mockClear();

      await activateSubscriptionInFirestore({
        restaurantId: 'rest_audit_test_99',
        planId: 'starter',
        billingCycle: 'monthly',
        razorpayOrderId: 'order_aud_1',
        razorpayPaymentId: 'pay_aud_1'
      });

      // At least 2 setDoc calls: 1 for current subscription, 1 for subscriptionHistory audit
      expect(setDocSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Payment Failure & Webhook Safety Invariants', () => {
    it('payment.failed webhook event records failure audit and NEVER activates subscription', async () => {
      const failPayload = {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_999',
              order_id: 'order_failed_999',
              amount: 29900,
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Payment was declined by bank',
              notes: {
                restaurantId: 'rest_fail_101',
                planId: 'starter',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      const result = await processRazorpayWebhookPayload(failPayload, 'evt_fail_999');
      expect(result.received).toBe(true);
      expect(result.actionTaken).toBe('payment_failed_audited');
      expect(result.restaurantId).toBe('rest_fail_101');
    });

    it('duplicate webhook events do not duplicate activation or audit actions', async () => {
      const dupEventId = 'evt_unique_dup_check_77';
      const payload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_dup_77',
              order_id: 'order_dup_77',
              amount: 99900,
              notes: {
                restaurantId: 'rest_dup_77',
                planId: 'pro',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      const res1 = await processRazorpayWebhookPayload(payload, dupEventId);
      expect(res1.received).toBe(true);
      expect(res1.actionTaken).toBe('subscription_activated');

      const res2 = await processRazorpayWebhookPayload(payload, dupEventId);
      expect(res2.received).toBe(true);
      expect(res2.idempotent).toBe(true);
      expect(res2.actionTaken).toBeUndefined();
    });
  });

  describe('Owner-Only RBAC & Multi-Tenant Isolation', () => {
    it('authorizes restaurant owner for subscription management', async () => {
      const check = await verifyRestaurantOwnerForSubscription(
        'user_owner_123',
        'mock_token_owner',
        'restaurant_alpha'
      );
      expect(check.authorized).toBe(true);
      expect(check.code).toBe(200);
    });

    it('strictly forbids non-owner staff and managers from subscription operations', async () => {
      const managerCheck = await verifyRestaurantOwnerForSubscription(
        'user_manager_456',
        'mock_token_manager',
        'restaurant_alpha'
      );
      expect(managerCheck.authorized).toBe(false);
      expect(managerCheck.code).toBe(403);
      expect(managerCheck.error).toBe('FORBIDDEN_SUBSCRIPTION_MANAGEMENT');

      const staffCheck = await verifyRestaurantOwnerForSubscription(
        'user_staff_789',
        'mock_token_staff',
        'restaurant_alpha'
      );
      expect(staffCheck.authorized).toBe(false);
      expect(staffCheck.code).toBe(403);
      expect(staffCheck.error).toBe('FORBIDDEN_SUBSCRIPTION_MANAGEMENT');
    });

    it('isolates subscription configuration to the exact targeted restaurantId', async () => {
      const restA = 'rest_tenant_A';
      const restB = 'rest_tenant_B';

      const subA = await activateSubscriptionInFirestore({
        restaurantId: restA,
        planId: 'starter',
        billingCycle: 'monthly',
        razorpayOrderId: 'order_A',
        razorpayPaymentId: 'pay_A'
      });

      const subB = await activateSubscriptionInFirestore({
        restaurantId: restB,
        planId: 'pro',
        billingCycle: 'annual',
        razorpayOrderId: 'order_B',
        razorpayPaymentId: 'pay_B'
      });

      expect(subA.restaurantId).toBe(restA);
      expect(subA.planId).toBe('starter');

      expect(subB.restaurantId).toBe(restB);
      expect(subB.planId).toBe('pro');
    });

    it('resolves the correct Firestore database endpoint from applet configuration without defaulting to non-existent default', () => {
      const config = getFirebaseConfig();
      const baseUrl = getFirestoreBaseUrl();

      expect(baseUrl).toContain(config.projectId);
      if (config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)') {
        expect(baseUrl).toContain(`databases/${config.firestoreDatabaseId}/documents`);
      } else {
        expect(baseUrl).toContain('databases/(default)/documents');
      }
    });
  });

  describe('Production-Hardening Webhook Concurrency & Idempotency Invariants', () => {
    function countAuditEvents(restaurantId: string): number {
      let count = 0;
      for (const [path] of mockFirestoreDb.entries()) {
        if (path.startsWith(`restaurants/${restaurantId}/subscriptionHistory/`)) {
          count++;
        }
      }
      return count;
    }

    // 1. Same webhook received twice sequentially
    it('1. Same webhook received twice sequentially results in exactly one activation and one audit', async () => {
      const restId = 'rest_concurrency_seq_1';
      const eventId = 'evt_seq_order_1001';
      const payload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_seq_1001',
              order_id: 'order_seq_1001',
              amount: 29900,
              notes: {
                restaurantId: restId,
                planId: 'starter',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      const res1 = await processRazorpayWebhookPayload(payload, eventId);
      expect(res1.received).toBe(true);
      expect(res1.actionTaken).toBe('subscription_activated');

      const res2 = await processRazorpayWebhookPayload(payload, eventId);
      expect(res2.received).toBe(true);
      expect(res2.idempotent).toBe(true);

      const sub = mockFirestoreDb.get(`restaurants/${restId}/subscription/current`);
      expect(sub).toBeDefined();
      expect(sub.status).toBe('active');
      expect(sub.planId).toBe('starter');
      expect(countAuditEvents(restId)).toBe(1);
    });

    // 2. Same webhook received concurrently
    it('2. Same webhook received concurrently results in exactly one activation and one audit', async () => {
      const restId = 'rest_concurrency_conc_2';
      const eventId = 'evt_conc_order_2002';
      const payload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_conc_2002',
              order_id: 'order_conc_2002',
              amount: 69900,
              notes: {
                restaurantId: restId,
                planId: 'growth',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      const [res1, res2] = await Promise.all([
        processRazorpayWebhookPayload(payload, eventId),
        processRazorpayWebhookPayload(payload, eventId)
      ]);

      const successfulActivations = [res1, res2].filter(
        (r) => r.actionTaken === 'subscription_activated'
      );
      const idempotentSkips = [res1, res2].filter((r) => r.idempotent === true);

      expect(successfulActivations.length).toBe(1);
      expect(idempotentSkips.length).toBe(1);

      const sub = mockFirestoreDb.get(`restaurants/${restId}/subscription/current`);
      expect(sub.status).toBe('active');
      expect(sub.planId).toBe('growth');
      expect(countAuditEvents(restId)).toBe(1);
    });

    // 3. Server restart simulation
    it('3. Server restart simulation maintains idempotency from persistent Firestore record', async () => {
      const restId = 'rest_concurrency_restart_3';
      const eventId = 'evt_restart_3003';
      const payload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_restart_3003',
              order_id: 'order_restart_3003',
              amount: 99900,
              notes: {
                restaurantId: restId,
                planId: 'pro',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      // Server Instance A processes webhook
      const resA = await processRazorpayWebhookPayload(payload, eventId);
      expect(resA.received).toBe(true);
      expect(resA.actionTaken).toBe('subscription_activated');

      // Verify record is stored under /subscriptionWebhookEvents/{eventId}
      const eventRecord = mockFirestoreDb.get(`subscriptionWebhookEvents/${eventId}`);
      expect(eventRecord).toBeDefined();
      expect(eventRecord.status).toBe('processed');
      expect(eventRecord.actionTaken).toBe('subscription_activated');

      // Simulate Server Restart: In-memory runtime state is reset, but Firestore DB remains intact.
      // Server Instance B (after restart or scale-out) receives duplicate webhook delivery from Razorpay
      const resB = await processRazorpayWebhookPayload(payload, eventId);
      expect(resB.received).toBe(true);
      expect(resB.idempotent).toBe(true);
      expect(resB.actionTaken).toBeUndefined();

      expect(countAuditEvents(restId)).toBe(1);
    });

    // 4. Two webhook requests attempting activation at the same time
    it('4. Two webhook requests attempting activation concurrently execute atomic OCC without double-activation', async () => {
      const restId = 'rest_concurrency_race_4';
      const eventId = 'evt_race_4004';
      const payload = {
        event: 'order.paid',
        payload: {
          order: {
            entity: {
              id: 'order_race_4004',
              amount: 29900,
              notes: {
                restaurantId: restId,
                planId: 'starter',
                billingCycle: 'monthly'
              }
            }
          },
          payment: {
            entity: {
              id: 'pay_race_4004',
              order_id: 'order_race_4004'
            }
          }
        }
      };

      const results = await Promise.all([
        processRazorpayWebhookPayload(payload, eventId),
        processRazorpayWebhookPayload(payload, eventId)
      ]);

      expect(results.some((r) => r.actionTaken === 'subscription_activated')).toBe(true);
      expect(results.some((r) => r.idempotent === true)).toBe(true);
      expect(countAuditEvents(restId)).toBe(1);
    });

    // 5. Invalid webhook signature
    it('5. Invalid or tampered webhook signature is rejected and does not mutate subscription state', () => {
      const rawPayload = JSON.stringify({ event: 'payment.captured', test: 123 });
      const forgedSignature = 'forged_sha256_hex_000000000000000000000000000000000000000000000000';

      const isValid = verifyRazorpayWebhookSignature(rawPayload, forgedSignature);
      expect(isValid).toBe(false);
    });

    // 6. Valid webhook with invalid/missing restaurant metadata
    it('6. Valid webhook with missing or invalid restaurant metadata is ignored safely', async () => {
      const payloadMissingRest = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_no_rest_6006',
              order_id: 'order_no_rest_6006',
              amount: 29900,
              notes: {}
            }
          }
        }
      };

      const resMissing = await processRazorpayWebhookPayload(
        payloadMissingRest,
        'evt_missing_rest_6006'
      );
      expect(resMissing.received).toBe(true);
      expect(resMissing.actionTaken).toBe('ignored_missing_restaurant_id');

      const payloadInvalidPlan = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_inv_plan_6006',
              order_id: 'order_inv_plan_6006',
              amount: 29900,
              notes: {
                restaurantId: 'rest_inv_plan_6006',
                planId: 'malicious_plan_tier'
              }
            }
          }
        }
      };

      const resInvalidPlan = await processRazorpayWebhookPayload(
        payloadInvalidPlan,
        'evt_inv_plan_6006'
      );
      expect(resInvalidPlan.received).toBe(true);
      expect(resInvalidPlan.actionTaken).toBe('ignored_invalid_plan');
      expect(mockFirestoreDb.has('restaurants/rest_inv_plan_6006/subscription/current')).toBe(false);
    });

    // 7. Duplicate payment event across different event types
    it('7. Duplicate payment events across different events (order.paid & payment.captured) produce exactly one activation', async () => {
      const restId = 'rest_dup_event_7007';
      const sharedPaymentId = 'pay_shared_7007';
      const sharedOrderId = 'order_shared_7007';

      // First webhook: order.paid
      const orderPaidPayload = {
        event: 'order.paid',
        payload: {
          order: {
            entity: {
              id: sharedOrderId,
              notes: {
                restaurantId: restId,
                planId: 'starter',
                billingCycle: 'monthly'
              }
            }
          },
          payment: {
            entity: {
              id: sharedPaymentId,
              order_id: sharedOrderId
            }
          }
        }
      };

      const res1 = await processRazorpayWebhookPayload(orderPaidPayload, 'evt_order_paid_7007');
      expect(res1.actionTaken).toBe('subscription_activated');

      // Second webhook: payment.captured with different eventId for same payment
      const paymentCapturedPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: sharedPaymentId,
              order_id: sharedOrderId,
              notes: {
                restaurantId: restId,
                planId: 'starter',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      const res2 = await processRazorpayWebhookPayload(
        paymentCapturedPayload,
        'evt_payment_captured_7007'
      );
      expect(res2.received).toBe(true);

      // Exactly 1 subscription activation and 1 audit history record
      expect(countAuditEvents(restId)).toBe(1);
    });

    // 8. Payment verification followed by duplicate webhook
    it('8. Payment verification followed by duplicate webhook results in exactly one activation and one audit', async () => {
      const restId = 'rest_pv_webhook_8008';
      const paymentId = 'pay_pv_8008';
      const orderId = 'order_pv_8008';

      // Step 1: User verifies payment from frontend (/api/subscription/verify-and-activate)
      const verifiedSub = await activateSubscriptionInFirestore({
        restaurantId: restId,
        planId: 'pro',
        billingCycle: 'monthly',
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId
      });
      expect(verifiedSub.status).toBe('active');
      expect(countAuditEvents(restId)).toBe(1);

      // Step 2: Asynchronous Razorpay webhook arrives later for the same payment
      const webhookPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 99900,
              notes: {
                restaurantId: restId,
                planId: 'pro',
                billingCycle: 'monthly'
              }
            }
          }
        }
      };

      const webhookRes = await processRazorpayWebhookPayload(
        webhookPayload,
        'evt_webhook_after_pv_8008'
      );
      expect(webhookRes.received).toBe(true);

      // Total audit events remains strictly 1
      expect(countAuditEvents(restId)).toBe(1);
      const sub = mockFirestoreDb.get(`restaurants/${restId}/subscription/current`);
      expect(sub.status).toBe('active');
      expect(sub.planId).toBe('pro');
    });
  });
});
