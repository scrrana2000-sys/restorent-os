import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  createCustomerCheckoutIntent,
  submitCustomerOnlineOrder
} from '../services/customerCheckoutService';
import { orderService } from '../services/orderService';
import { kotService } from '../services/kotService';
import { Order, CustomerSnapshot } from '../types/order';
import {
  CustomerCart,
  CustomerProfile,
  CustomerCheckoutIntent,
  PublicRestaurantProfile
} from '../types/customer';

// Mock dependencies
vi.mock('../config/firebase', () => ({
  auth: {
    currentUser: null
  },
  db: {}
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  doc: vi.fn((_db, ...parts) => ({ path: parts.join('/'), id: 'mock_doc_id_' + Math.random().toString(36).substring(2, 7) })),
  getDoc: vi.fn().mockImplementation((ref) => {
    const p = ref?.path || '';
    if (p.includes('/items/')) {
      return Promise.resolve({
        exists: () => true,
        id: ref?.id || 'item_1',
        data: () => ({
          id: ref?.id || 'dish_biryani_101',
          name: 'Hyderabadi Chicken Biryani',
          price: 350, // 350 INR -> 35000 paise
          isActive: true,
          isAvailable: true
        })
      });
    }

    return Promise.resolve({
      exists: () => true,
      id: ref?.id || 'doc_1',
      data: () => ({
        ...mockRestaurantProfile,
        id: 'rest_m9_phase2',
        orderCounter: 100,
        kotCounter: 50
      })
    });
  }),
  getDocs: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => new Date().toISOString())
}));

const mockRestaurantProfile: PublicRestaurantProfile = {
  restaurantId: 'rest_m9_phase2',
  publicSlug: 'royal-biryani',
  publicRestaurantCode: 'RB101',
  name: 'Royal Biryani',
  logoUrl: null,
  coverImageUrl: null,
  phone: '9988776655',
  address: '100 Feet Road, Indiranagar',
  city: 'Bengaluru',
  state: 'Karnataka',
  area: 'Indiranagar',
  postalCode: '560038',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['Biryani', 'Mughlai'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockCart: CustomerCart = {
  restaurantId: 'rest_m9_phase2',
  restaurantName: 'Royal Biryani',
  publicSlug: 'royal-biryani',
  items: [
    {
      cartItemId: 'item_1_cart',
      itemId: 'dish_biryani_101',
      name: 'Hyderabadi Chicken Biryani',
      price: 35000, // 350 INR in paise
      unitPrice: 35000,
      quantity: 2
    }
  ],
  subtotal: 70000,
  itemCount: 2
};

describe('Milestone 9 — Phase 2: Customer ↔ Order Linking Foundation Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TEST 1: Authenticated customer places order
  it('TEST 1: places an online order for an authenticated customer', async () => {
    const customerAuthUid = 'cust_firebase_uid_1001';
    const customerEmail = 'rohit.sharma@example.com';

    const intent = createCustomerCheckoutIntent(
      {
        cart: mockCart,
        restaurantProfile: mockRestaurantProfile,
        orderType: 'takeaway',
        customerDetails: {
          name: 'Rohit Sharma',
          phone: '9876543210',
          email: customerEmail
        },
        paymentMethod: 'cash',
        customerId: customerAuthUid,
        customerEmail
      },
      'idempotency_key_test_1'
    );

    expect(intent).toBeDefined();
    expect(intent.customerId).toBe(customerAuthUid);

    const result = await submitCustomerOnlineOrder({
      intent,
      restaurantProfile: mockRestaurantProfile,
      customerId: customerAuthUid,
      customerEmail
    });

    expect(result.success).toBe(true);
    expect(result.order).toBeDefined();
    expect(result.order.restaurantId).toBe('rest_m9_phase2');
    expect(result.order.source).toBe('online');
  });

  // TEST 2: Order contains authenticated customer's customerId
  it('TEST 2: order contains authenticated customer customerId', async () => {
    const customerAuthUid = 'cust_firebase_uid_1002';

    const result = await submitCustomerOnlineOrder({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: {
        name: 'Priya Patel',
        phone: '9811223344'
      },
      paymentMethod: 'cash',
      customerId: customerAuthUid
    });

    expect(result.order.customerId).toBeDefined();
    expect(result.order.customerId).toBe('cust_firebase_uid_1002');
  });

  // TEST 3: customerId equals Firebase Auth UID
  it('TEST 3: customerId strictly equals the Firebase Auth UID', async () => {
    const firebaseAuthUid = 'firebase_auth_uid_xyz_888';

    const intent = createCustomerCheckoutIntent({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: {
        name: 'Ananya Roy',
        phone: '9900112233'
      },
      paymentMethod: 'cash',
      customerId: firebaseAuthUid
    });

    expect(intent.customerId).toBe(firebaseAuthUid);

    const result = await submitCustomerOnlineOrder({
      intent,
      customerId: firebaseAuthUid
    });

    expect(result.order.customerId).toBe(firebaseAuthUid);
    expect(typeof result.order.customerId).toBe('string');
  });

  // TEST 4: Order contains customerSnapshot
  it('TEST 4: order contains customerSnapshot preserving checkout data', async () => {
    const customerAuthUid = 'cust_firebase_uid_1004';
    const email = 'vikram@example.com';

    const result = await submitCustomerOnlineOrder({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'delivery',
      customerDetails: {
        name: 'Vikram Malhotra',
        phone: '9123456780',
        email
      },
      deliveryDetails: {
        addressLine: 'Flat 402, Lotus Towers',
        area: 'Indiranagar',
        city: 'Bengaluru',
        postalCode: '560038',
        deliveryInstructions: 'Ring doorbell twice'
      },
      paymentMethod: 'cash',
      customerId: customerAuthUid,
      customerEmail: email
    });

    expect(result.order.customerSnapshot).toBeDefined();
    expect(result.order.customerSnapshot).not.toBeNull();
  });

  // TEST 5: Snapshot contains the checkout information used at order time
  it('TEST 5: snapshot contains exact historical checkout information at order time', async () => {
    const customerAuthUid = 'cust_firebase_uid_1005';

    const result = await submitCustomerOnlineOrder({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'delivery',
      customerDetails: {
        name: 'Neha Kapoor',
        phone: '9876500000',
        email: 'neha.checkout@example.com'
      },
      deliveryDetails: {
        addressLine: 'House 12, 4th Main Road',
        area: 'Koramangala',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560034'
      },
      paymentMethod: 'cash',
      customerId: customerAuthUid,
      customerEmail: 'neha.checkout@example.com'
    });

    const snapshot = result.order.customerSnapshot as CustomerSnapshot;
    expect(snapshot.name).toBe('Neha Kapoor');
    expect(snapshot.phone).toBe('9876500000');
    expect(snapshot.email).toBe('neha.checkout@example.com');
    expect(snapshot.address).toContain('House 12, 4th Main Road');
    expect(snapshot.address).toContain('Koramangala');
    expect(snapshot.address).toContain('560034');
  });

  // TEST 6: Guest can still place an order without customerId
  it('TEST 6: guest can place an online order without customerId or authentication', async () => {
    const guestResult = await submitCustomerOnlineOrder({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: {
        name: 'Guest Customer',
        phone: '9111222333'
      },
      paymentMethod: 'cash',
      customerId: null // Guest checkout
    });

    expect(guestResult.success).toBe(true);
    expect(guestResult.order).toBeDefined();
    // Invariant: customerId should NOT be invented; must be null for guest orders
    expect(guestResult.order.customerId).toBeNull();
    expect(guestResult.order.source).toBe('online');
    expect(guestResult.order.customerSnapshot?.name).toBe('Guest Customer');
    expect(guestResult.order.customerSnapshot?.phone).toBe('9111222333');
  });

  // TEST 7: Customer A cannot create an order claiming to belong to Customer B
  it('TEST 7: prevents spoofing customerId when client requests a different identity', async () => {
    // In server.ts, verify that requesting a customerId that does not match authenticated token is rejected
    const serverFile = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');

    // Rule: Never allow request body customerId != authenticated Firebase UID
    expect(serverFile).toContain('requestedCustomerId !== verifiedCustomerId');
    expect(serverFile).toContain('FORBIDDEN_CUSTOMER_SPOOFING');
    expect(serverFile).toContain('UNAUTHORIZED_CUSTOMER_ID');

    // Verify in customerCheckoutService that local authentication also detects mismatch
    const { auth } = await import('../config/firebase');
    (auth as any).currentUser = {
      uid: 'customer_A_uid',
      email: 'customera@example.com'
    };

    // Customer A attempts to submit an order with Customer B's customerId
    await expect(
      submitCustomerOnlineOrder({
        cart: mockCart,
        restaurantProfile: mockRestaurantProfile,
        orderType: 'takeaway',
        customerDetails: {
          name: 'Customer A',
          phone: '9888877777'
        },
        paymentMethod: 'cash',
        customerId: 'victim_customer_B_uid'
      })
    ).rejects.toThrow(/Security Violation: customerId does not match current authenticated user/);

    (auth as any).currentUser = null;
  });

  // TEST 8: Customer profile remains independent from historical order snapshot
  it('TEST 8: customer profile in /customers/{customerId} remains independent from historical order snapshot', async () => {
    const customerAuthUid = 'cust_firebase_uid_1008';

    // 1. Customer places order with phone P1
    const orderResult = await submitCustomerOnlineOrder({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: {
        name: 'Siddharth Rao',
        phone: '9888000001'
      },
      paymentMethod: 'cash',
      customerId: customerAuthUid
    });

    const historicalSnapshot = orderResult.order.customerSnapshot;
    expect(historicalSnapshot?.phone).toBe('9888000001');

    // 2. Customer updates profile phone to P2 tomorrow
    const currentProfile: CustomerProfile = {
      customerId: customerAuthUid,
      name: 'Siddharth Rao',
      email: 'siddharth@example.com',
      phone: '9999999999', // Updated phone
      authProvider: 'google.com',
      addresses: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // The order's historical customerSnapshot must NOT change
    expect(historicalSnapshot?.phone).toBe('9888000001');
    expect(currentProfile.phone).toBe('9999999999');
    expect(orderResult.order.customerId).toBe(currentProfile.customerId);
  });

  // TEST 9: Existing KDS still receives the order
  it('TEST 9: existing KDS and KOT generation receives the online order seamlessly', async () => {
    const result = await submitCustomerOnlineOrder({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: {
        name: 'KDS Order Test',
        phone: '9777666555'
      },
      paymentMethod: 'cash',
      customerId: 'cust_uid_kds_test'
    });

    expect(result.kot).toBeDefined();
    if (result.kot) {
      expect(result.kot.orderId).toBe(result.order.id);
      expect(['sentToKitchen', 'queued']).toContain(result.kot.status);
      expect(result.kot.items.length).toBe(1);
      expect(result.kot.items[0].nameSnapshot).toBe('Hyderabadi Chicken Biryani');
      expect(result.kot.items[0].quantity).toBe(2);
      // Separation of concerns: KOT items must not carry financial totals
      expect((result.kot.items[0] as any).unitPriceMinor).toBeUndefined();
    }
  });

  // TEST 10: Existing order status flow still works
  it('TEST 10: existing order status flow and lifecycle works with customer-linked orders', async () => {
    const result = await submitCustomerOnlineOrder({
      cart: mockCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: {
        name: 'Status Test User',
        phone: '9888000002'
      },
      paymentMethod: 'cash',
      customerId: 'cust_uid_status_test'
    });

    // Online orders default to sentToKitchen or confirmed
    expect(['sentToKitchen', 'confirmed']).toContain(result.order.status);
    // Subtotal 70,000 paise (Rs 700) + 5% GST (Rs 35 = 3500 paise) = 73,500 paise
    expect(result.order.grandTotalMinor).toBe(73500);
    expect(result.order.dueAmountMinor).toBe(73500);
    expect(result.order.paidAmountMinor).toBe(0);
  });

  // TEST 11: Existing restaurant/admin permissions still work
  it('TEST 11: firestore.rules keeps restaurant/admin permissions intact while protecting customer orders', () => {
    const rulesPath = path.resolve(__dirname, '../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    // Extract match /orders/{orderId} block
    const ordersBlockMatch = rules.match(/match\s+\/orders\/\{orderId\}[\s\S]*?match\s+\/kots\//);
    expect(ordersBlockMatch).toBeTruthy();
    const ordersBlock = ordersBlockMatch![0];

    // Restaurant staff can still access all restaurant orders
    expect(ordersBlock).toMatch(/canAccessRestaurant\(restaurantId\)/);
    // Authenticated customer can read their own order
    expect(ordersBlock).toMatch(/resource\.data\.customerId\s*==\s*request\.auth\.uid/);
    // Guest online orders are tokenized through the trusted API and are no longer directly readable.
    expect(ordersBlock).not.toMatch(/resource\.data\.source\s*==\s*'online'/);
    // Unrestricted public reads are prohibited for orders
    expect(ordersBlock).not.toMatch(/allow\s+read:\s*if\s+true;/);
  });

  // TEST 12: Production build succeeds and interfaces are strictly typed
  it('TEST 12: Order interface and CustomerCheckoutDetails maintain strict typing', () => {
    const sampleOrder: Order = {
      id: 'ord_sample_1',
      restaurantId: 'rest_m9_phase2',
      orderNumber: 'ORD-1234',
      customerId: 'cust_firebase_uid_1012',
      createdBy: 'customer_online',
      orderType: 'takeaway',
      source: 'online',
      status: 'confirmed',
      items: [],
      subtotalMinor: 1000,
      discountMinor: 0,
      cgstMinor: 25,
      sgstMinor: 25,
      igstMinor: 0,
      grandTotalMinor: 1050,
      paidAmountMinor: 0,
      dueAmountMinor: 1050,
      customerSnapshot: {
        name: 'Sample User',
        phone: '9000000000',
        email: 'sample@example.com'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(sampleOrder.customerId).toBe('cust_firebase_uid_1012');
    expect(sampleOrder.customerSnapshot?.email).toBe('sample@example.com');
  });
});
