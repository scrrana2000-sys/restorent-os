import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Order } from '../types/order';
import { orderService } from '../services/orderService';
import { orderFinalizationService } from '../services/orderFinalizationService';
import { enforcePermission } from '../utils/permissions';

// Mock Firebase firestore and auth
vi.mock('../config/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'test-user-123' } }
}));

// Mock firestore functions
const mockDocs: Record<string, any> = {};

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...pathSegments) => ({
    path: pathSegments.join('/')
  })),
  doc: vi.fn((_db, ...pathSegments) => {
    const fullPath = pathSegments.join('/');
    return {
      path: fullPath,
      id: pathSegments[pathSegments.length - 1]
    };
  }),
  getDoc: vi.fn(async (docRef) => {
    const data = mockDocs[docRef.path];
    return {
      exists: () => !!data,
      id: docRef.id,
      data: () => data
    };
  }),
  getDocs: vi.fn(async (queryRef) => {
    const path = queryRef.path || queryRef._path || '';
    const matching = Object.entries(mockDocs)
      .filter(([k]) => k.startsWith(path))
      .map(([id, data]) => ({
        id: id.split('/').pop(),
        data: () => data
      }));
    return {
      docs: matching,
      forEach: (cb: any) => matching.forEach(cb)
    };
  }),
  setDoc: vi.fn(async (docRef, data) => {
    mockDocs[docRef.path] = data;
  }),
  updateDoc: vi.fn(async (docRef, data) => {
    if (mockDocs[docRef.path]) {
      mockDocs[docRef.path] = { ...mockDocs[docRef.path], ...data };
    }
  }),
  query: vi.fn((colRef) => ({ path: colRef.path })),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn((qRef, onNext, _onError) => {
    const path = qRef.path || '';
    const matching = Object.entries(mockDocs)
      .filter(([k]) => k.startsWith(path))
      .map(([id, data]) => ({
        id: id.split('/').pop(),
        data: () => data
      }));
    onNext({
      docs: matching,
      forEach: (cb: any) => matching.forEach(cb)
    });
    return () => {};
  }),
  serverTimestamp: vi.fn(() => new Date().toISOString()),
  runTransaction: vi.fn(async (_db, updateFunction) => {
    const transaction = {
      get: async (docRef: any) => {
        const data = mockDocs[docRef.path];
        return {
          exists: () => !!data,
          id: docRef.id,
          data: () => data
        };
      },
      set: (docRef: any, data: any) => {
        mockDocs[docRef.path] = data;
      },
      update: (docRef: any, data: any) => {
        if (mockDocs[docRef.path]) {
          mockDocs[docRef.path] = { ...mockDocs[docRef.path], ...data };
        }
      }
    };
    return updateFunction(transaction);
  })
}));

// Mock permissions
vi.mock('../utils/permissions', () => ({
  enforcePermission: vi.fn().mockResolvedValue(true),
  hasPermission: vi.fn().mockReturnValue(true)
}));

describe('PHASE 4.5: POS PAYMENT DUE / COLLECTION CENTER HARDENING', () => {
  const restaurantId = 'rest-123';

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockDocs).forEach((key) => delete mockDocs[key]);
  });

  it('1. Unpaid takeaway order appears in Payment Due', async () => {
    const takeawayOrder: Partial<Order> = {
      id: 'ord-takeaway-1',
      restaurantId,
      orderNumber: '101',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 15750,
      paidAmountMinor: 0,
      dueAmountMinor: 15750,
      tableId: null,
      tableSessionId: null,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-takeaway-1`] = takeawayOrder;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(1);
    expect(dues[0].id).toBe('ord-takeaway-1');
    expect(dues[0].orderType).toBe('takeaway');
    expect(dues[0].dueAmountMinor).toBe(15750);
  });

  it('2. Unpaid dine-in order appears in Payment Due', async () => {
    const dineInOrder: Partial<Order> = {
      id: 'ord-dinein-1',
      restaurantId,
      orderNumber: '102',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'unpaid',
      grandTotalMinor: 65000,
      paidAmountMinor: 0,
      dueAmountMinor: 65000,
      tableId: 'Table 3',
      tableSessionId: 'session-102',
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-dinein-1`] = dineInOrder;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(1);
    expect(dues[0].id).toBe('ord-dinein-1');
    expect(dues[0].orderType).toBe('dineIn');
    expect(dues[0].tableId).toBe('Table 3');
  });

  it('3. Served + unpaid order remains visible in Payment Due', async () => {
    const servedOrder: Partial<Order> = {
      id: 'ord-served-1',
      restaurantId,
      orderNumber: '103',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'unpaid',
      grandTotalMinor: 50000,
      paidAmountMinor: 0,
      dueAmountMinor: 50000,
      tableId: 'Table 1',
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-served-1`] = servedOrder;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(1);
    expect(dues[0].status).toBe('served');
    expect(dues[0].dueAmountMinor).toBe(50000);
  });

  it('4. Partial payment order remains visible in Payment Due', async () => {
    const partialOrder: Partial<Order> = {
      id: 'ord-partial-1',
      restaurantId,
      orderNumber: '104',
      orderType: 'takeaway',
      status: 'preparing',
      paymentStatus: 'partially_paid',
      grandTotalMinor: 100000,
      paidAmountMinor: 40000,
      dueAmountMinor: 60000,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-partial-1`] = partialOrder;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(1);
    expect(dues[0].paymentStatus).toBe('partially_paid');
  });

  it('5. Partial payment displays correct remaining due amount', async () => {
    const partialOrder: Partial<Order> = {
      id: 'ord-partial-1',
      restaurantId,
      orderNumber: '104',
      orderType: 'takeaway',
      status: 'preparing',
      paymentStatus: 'partially_paid',
      grandTotalMinor: 100000,
      paidAmountMinor: 40000,
      dueAmountMinor: 60000,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-partial-1`] = partialOrder;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues[0].dueAmountMinor).toBe(60000);
  });

  it('6. Final payment removes order from Payment Due', async () => {
    const order: Partial<Order> = {
      id: 'ord-105',
      restaurantId,
      orderNumber: '105',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 30000,
      paidAmountMinor: 0,
      dueAmountMinor: 30000,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-105`] = order;

    let dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(1);

    // Simulate final payment
    mockDocs[`restaurants/${restaurantId}/orders/ord-105`] = {
      ...order,
      paidAmountMinor: 30000,
      dueAmountMinor: 0,
      paymentStatus: 'paid'
    };

    dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(0);
  });

  it('7. Realtime payment subscription callback emits updated due list', () => {
    const order: Partial<Order> = {
      id: 'ord-rt-1',
      restaurantId,
      orderNumber: '106',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'unpaid',
      grandTotalMinor: 40000,
      paidAmountMinor: 0,
      dueAmountMinor: 40000,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-rt-1`] = order;

    const callback = vi.fn();
    const unsub = orderService.subscribeToPaymentDueOrders(restaurantId, callback);

    expect(callback).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'ord-rt-1', dueAmountMinor: 40000 })
    ]));

    unsub();
  });

  it('8. Refund creating outstanding balance re-adds order to Payment Due', async () => {
    const refundedOrder: Partial<Order> = {
      id: 'ord-refund-1',
      restaurantId,
      orderNumber: '107',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'partially_paid',
      grandTotalMinor: 100000,
      paidAmountMinor: 70000, // Refunded 30000 from 100000
      dueAmountMinor: 30000,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-refund-1`] = refundedOrder;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(1);
    expect(dues[0].dueAmountMinor).toBe(30000);
  });

  it('9. Payment Due shows correct order type for Dine-In vs Takeaway', async () => {
    const ord1: Partial<Order> = {
      id: 'ord-t-1',
      restaurantId,
      orderNumber: '108',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 20000,
      paidAmountMinor: 0,
      dueAmountMinor: 20000,
      createdAt: new Date().toISOString()
    };
    const ord2: Partial<Order> = {
      id: 'ord-d-1',
      restaurantId,
      orderNumber: '109',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'unpaid',
      grandTotalMinor: 50000,
      paidAmountMinor: 0,
      dueAmountMinor: 50000,
      tableId: 'Table 5',
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-t-1`] = ord1;
    mockDocs[`restaurants/${restaurantId}/orders/ord-d-1`] = ord2;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(2);
    const takeaway = dues.find((d) => d.orderType === 'takeaway');
    const dineIn = dues.find((d) => d.orderType === 'dineIn');

    expect(takeaway).toBeDefined();
    expect(dineIn).toBeDefined();
    expect(dineIn?.tableId).toBe('Table 5');
  });

  it('10. Dine-In unpaid order displays table ID', async () => {
    const ord: Partial<Order> = {
      id: 'ord-d-2',
      restaurantId,
      orderNumber: '110',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'unpaid',
      grandTotalMinor: 35000,
      paidAmountMinor: 0,
      dueAmountMinor: 35000,
      tableId: 'Table 12',
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-d-2`] = ord;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues[0].tableId).toBe('Table 12');
  });

  it('11. Takeaway order has no table assignment', async () => {
    const ord: Partial<Order> = {
      id: 'ord-t-2',
      restaurantId,
      orderNumber: '111',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 25000,
      paidAmountMinor: 0,
      dueAmountMinor: 25000,
      tableId: null,
      tableSessionId: null,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-t-2`] = ord;

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues[0].tableId).toBeNull();
    expect(dues[0].tableSessionId).toBeNull();
  });

  it('12. Payment Due is strictly tenant isolated by restaurantId', async () => {
    const ordRestA: Partial<Order> = {
      id: 'ord-a-1',
      restaurantId: 'rest-A',
      orderNumber: '201',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 10000,
      paidAmountMinor: 0,
      dueAmountMinor: 10000,
      createdAt: new Date().toISOString()
    };
    const ordRestB: Partial<Order> = {
      id: 'ord-b-1',
      restaurantId: 'rest-B',
      orderNumber: '301',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 20000,
      paidAmountMinor: 0,
      dueAmountMinor: 20000,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/rest-A/orders/ord-a-1`] = ordRestA;
    mockDocs[`restaurants/rest-B/orders/ord-b-1`] = ordRestB;

    const duesA = await orderService.getPaymentDueOrders('rest-A');
    expect(duesA).toHaveLength(1);
    expect(duesA[0].id).toBe('ord-a-1');
  });

  it('13. Enforces RBAC permissions for order viewing', async () => {
    await orderService.getPaymentDueOrders(restaurantId);
    expect(enforcePermission).toHaveBeenCalledWith(restaurantId, 'view_orders');
  });

  it('14. Multiple unpaid orders all appear in Payment Due', async () => {
    mockDocs[`restaurants/${restaurantId}/orders/ord-m-1`] = {
      id: 'ord-m-1',
      restaurantId,
      orderNumber: '1',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'unpaid',
      grandTotalMinor: 10000,
      dueAmountMinor: 10000,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-m-2`] = {
      id: 'ord-m-2',
      restaurantId,
      orderNumber: '2',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 20000,
      dueAmountMinor: 20000,
      createdAt: new Date().toISOString()
    };

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(2);
  });

  it('15. Settling one order leaves other unpaid orders in Payment Due', async () => {
    mockDocs[`restaurants/${restaurantId}/orders/ord-m-1`] = {
      id: 'ord-m-1',
      restaurantId,
      orderNumber: '1',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'paid',
      grandTotalMinor: 10000,
      paidAmountMinor: 10000,
      dueAmountMinor: 0,
      createdAt: new Date().toISOString()
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-m-2`] = {
      id: 'ord-m-2',
      restaurantId,
      orderNumber: '2',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      grandTotalMinor: 20000,
      paidAmountMinor: 0,
      dueAmountMinor: 20000,
      createdAt: new Date().toISOString()
    };

    const dues = await orderService.getPaymentDueOrders(restaurantId);
    expect(dues).toHaveLength(1);
    expect(dues[0].id).toBe('ord-m-2');
  });

  it('16. Dine-In order with outstanding due prevents automatic session closure', async () => {
    const sessionDoc = {
      id: 'session-blocked',
      restaurantId,
      tableId: 'Table 1',
      status: 'open',
      activeOrderIds: ['ord-blocked-1']
    };
    mockDocs[`restaurants/${restaurantId}/tableSessions/session-blocked`] = sessionDoc;

    const orderDoc = {
      id: 'ord-blocked-1',
      restaurantId,
      tableSessionId: 'session-blocked',
      status: 'served',
      paymentStatus: 'partially_paid',
      grandTotalMinor: 50000,
      paidAmountMinor: 20000,
      dueAmountMinor: 30000
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-blocked-1`] = orderDoc;

    const res = await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
      restaurantId,
      'ord-blocked-1',
      'user-1'
    );

    expect(res.orderCompleted).toBe(false);
    expect(res.sessionClosed).toBe(false);
    expect(mockDocs[`restaurants/${restaurantId}/tableSessions/session-blocked`].status).toBe('open');
  });

  it('17. Fully paid order with terminal KOT allows completion and automatic session closure', async () => {
    const sessionDoc = {
      id: 'session-completed',
      restaurantId,
      tableId: 'Table 2',
      status: 'open',
      activeOrderIds: ['ord-free-1']
    };
    mockDocs[`restaurants/${restaurantId}/tableSessions/session-completed`] = sessionDoc;

    const orderDoc = {
      id: 'ord-free-1',
      restaurantId,
      tableSessionId: 'session-completed',
      status: 'served',
      paymentStatus: 'paid',
      grandTotalMinor: 50000,
      paidAmountMinor: 50000,
      dueAmountMinor: 0
    };
    mockDocs[`restaurants/${restaurantId}/orders/ord-free-1`] = orderDoc;

    // KOT doc terminal
    mockDocs[`restaurants/${restaurantId}/kots/kot-free-1`] = {
      id: 'kot-free-1',
      orderId: 'ord-free-1',
      status: 'served'
    };

    const res = await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
      restaurantId,
      'ord-free-1',
      'user-1'
    );

    expect(res.orderCompleted).toBe(true);
  });
});
