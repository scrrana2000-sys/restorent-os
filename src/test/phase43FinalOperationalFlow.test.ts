import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orderFinalizationService } from '../services/orderFinalizationService';
import { tableSessionService } from '../services/tableSessionService';
import { Order } from '../types/order';
import { KOT } from '../types/kot';
import { TableSession } from '../types/table';

// Mock Firestore SDK
vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn((_db, ...pathSegments) => ({ type: 'collection', path: pathSegments.join('/') })),
    doc: vi.fn((_dbOrCol, ...pathSegments) => {
      const id = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : `mock_id_${Math.random().toString(36).substring(2, 8)}`;
      return { id, path: pathSegments.join('/') };
    }),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    query: vi.fn((colRef, ...clauses) => ({ type: 'query', colRef, clauses })),
    where: vi.fn((field, op, val) => ({ type: 'where', field, op, val })),
    orderBy: vi.fn((field, dir) => ({ type: 'orderBy', field, dir })),
    onSnapshot: vi.fn(() => vi.fn()),
    serverTimestamp: vi.fn(() => new Date('2026-09-11T12:00:00Z')),
    runTransaction: vi.fn(async (_db, callback) => {
      const mockTx = {
        get: vi.fn(),
        set: vi.fn(),
        update: vi.fn()
      };
      return callback(mockTx);
    })
  };
});

// Mock Audit Service
vi.mock('../services/auditService', () => ({
  auditService: {
    logEvent: vi.fn().mockResolvedValue(undefined)
  }
}));

// Mock Firebase Config
vi.mock('../config/firebase', () => ({
  db: { type: 'mockDb' },
  auth: { currentUser: { uid: 'CASHIER_USER_1' } }
}));

// Mock permissions
vi.mock('../utils/permissions', () => ({
  enforcePermission: vi.fn().mockResolvedValue(true),
  hasPermission: vi.fn().mockReturnValue(true)
}));

import * as firestore from 'firebase/firestore';

describe('PHASE 4.3: FINAL OPERATIONAL FLOW — PAYMENT → AUTO COMPLETE → AUTO CLOSE TABLE SESSION', () => {
  const restaurantId = 'REST_FLOW_TEST_01';
  const tableId = 'TBL_101';
  const sessionId = 'SESS_2026_001';
  const orderId = 'ORD_9001';
  const paymentAmountsByOrder: Record<string, number> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(paymentAmountsByOrder).forEach((key) => delete paymentAmountsByOrder[key]);
  });

  it('1. Auto-completes order and auto-closes session when Payment settled and KOT already served', async () => {
    const mockOrder: Order = {
      id: orderId,
      restaurantId,
      orderNumber: 'ORD-9001',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'served',
      items: [
        {
          itemId: 'm_1',
          nameSnapshot: 'Paneer Tikka',
          shortNameSnapshot: 'Paneer Tikka',
          quantity: 2,
          unitPriceMinor: 25000,
          taxRate: 5,
          taxInclusive: false,
          discountMinor: 0,
          lineSubtotalMinor: 50000,
          lineTaxMinor: 2500,
          lineTotalMinor: 52500
        }
      ],
      subtotalMinor: 50000,
      discountMinor: 0,
      totalTaxMinor: 2500,
      cgstMinor: 1250,
      sgstMinor: 1250,
      igstMinor: 0,
      grandTotalMinor: 52500,
      paidAmountMinor: 52500,
      dueAmountMinor: 0,
      paymentStatus: 'paid',
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    paymentAmountsByOrder[orderId] = 52500;

    const mockKot: KOT = {
      id: 'KOT_101',
      restaurantId,
      kotNumber: 'KOT-1',
      orderId,
      tableId,
      status: 'served',
      items: [],
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      guestCount: 2,
      openedAt: new Date(),
      activeOrderIds: [orderId],
      openedBy: 'WAITER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async (docRef: any) => {
      if (docRef.path.includes(`orders/${orderId}`)) {
        return { exists: () => true, data: () => mockOrder } as any;
      }
      if (docRef.path.includes(`tableSessions/${sessionId}`)) {
        return { exists: () => true, data: () => mockSession } as any;
      }
      return { exists: () => false } as any;
    });

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('kots')) {
        return { docs: [{ id: 'KOT_101', data: () => mockKot }] } as any;
      }
      if (queryObj.colRef?.path?.includes('orders')) {
        return { docs: [{ id: orderId, data: () => mockOrder }] } as any;
      }
      if (queryObj.colRef?.path?.includes('payments')) {
        const requestedOrderId = queryObj.clauses?.find((clause: any) => clause.field === 'orderId')?.val;
        const amountMinor = requestedOrderId ? paymentAmountsByOrder[requestedOrderId] : undefined;
        return amountMinor
          ? { docs: [{ id: 'PAY-' + requestedOrderId, data: () => ({ id: 'PAY-' + requestedOrderId, orderId: requestedOrderId, amountMinor, status: 'completed' }) }] } as any
          : { docs: [] } as any;
      }
      return { docs: [] } as any;
    });

    const updateDocSpy = vi.spyOn(firestore, 'updateDoc').mockResolvedValue(undefined);
    const closeSessionSpy = vi.spyOn(tableSessionService, 'closeSession').mockResolvedValue(undefined);

    const result = await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
      restaurantId,
      orderId,
      'CASHIER_USER_1'
    );

    expect(result.orderCompleted).toBe(true);
    expect(result.sessionClosed).toBe(true);
    expect(updateDocSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'completed'
      })
    );
    expect(closeSessionSpy).toHaveBeenCalledWith(
      restaurantId,
      sessionId,
      'CASHIER_USER_1',
      expect.objectContaining({ autoCompleteSettledOrders: true })
    );
  });

  it('2. Prevents auto-completion if KOT is still PREPARING even if payment is fully paid', async () => {
    const mockOrder: Order = {
      id: orderId,
      restaurantId,
      orderNumber: 'ORD-9002',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'preparing',
      items: [],
      subtotalMinor: 50000,
      discountMinor: 0,
      totalTaxMinor: 2500,
      cgstMinor: 1250,
      sgstMinor: 1250,
      igstMinor: 0,
      grandTotalMinor: 52500,
      paidAmountMinor: 52500,
      dueAmountMinor: 0,
      paymentStatus: 'paid',
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockKotPreparing: KOT = {
      id: 'KOT_102',
      restaurantId,
      kotNumber: 'KOT-2',
      orderId,
      tableId,
      status: 'preparing',
      items: [],
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async () => ({
      exists: () => true,
      data: () => mockOrder
    }) as any);

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('kots')) {
        return { docs: [{ id: 'KOT_102', data: () => mockKotPreparing }] } as any;
      }
      return { docs: [] } as any;
    });

    const updateDocSpy = vi.spyOn(firestore, 'updateDoc');
    const closeSessionSpy = vi.spyOn(tableSessionService, 'closeSession');

    const result = await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
      restaurantId,
      orderId,
      'CASHIER_USER_1'
    );

    expect(result.orderCompleted).toBe(false);
    expect(result.sessionClosed).toBe(false);
    expect(updateDocSpy).not.toHaveBeenCalled();
    expect(closeSessionSpy).not.toHaveBeenCalled();
  });

  it('3. Auto-closes session when KOT becomes SERVED after Payment was already settled', async () => {
    const mockOrder: Order = {
      id: orderId,
      restaurantId,
      orderNumber: 'ORD-9003',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'served',
      items: [],
      subtotalMinor: 50000,
      discountMinor: 0,
      totalTaxMinor: 2500,
      cgstMinor: 1250,
      sgstMinor: 1250,
      igstMinor: 0,
      grandTotalMinor: 52500,
      paidAmountMinor: 52500,
      dueAmountMinor: 0,
      paymentStatus: 'paid',
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    paymentAmountsByOrder[orderId] = 52500;

    const mockKotServed: KOT = {
      id: 'KOT_103',
      restaurantId,
      kotNumber: 'KOT-3',
      orderId,
      tableId,
      status: 'served',
      items: [],
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      guestCount: 2,
      openedAt: new Date(),
      activeOrderIds: [orderId],
      openedBy: 'WAITER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async (docRef: any) => {
      if (docRef.path.includes(`orders/${orderId}`)) {
        return { exists: () => true, data: () => mockOrder } as any;
      }
      if (docRef.path.includes(`tableSessions/${sessionId}`)) {
        return { exists: () => true, data: () => mockSession } as any;
      }
      return { exists: () => false } as any;
    });

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('kots')) {
        return { docs: [{ id: 'KOT_103', data: () => mockKotServed }] } as any;
      }
      if (queryObj.colRef?.path?.includes('orders')) {
        return { docs: [{ id: orderId, data: () => mockOrder }] } as any;
      }
      if (queryObj.colRef?.path?.includes('payments')) {
        const requestedOrderId = queryObj.clauses?.find((clause: any) => clause.field === 'orderId')?.val;
        const amountMinor = requestedOrderId ? paymentAmountsByOrder[requestedOrderId] : undefined;
        return amountMinor
          ? { docs: [{ id: 'PAY-' + requestedOrderId, data: () => ({ id: 'PAY-' + requestedOrderId, orderId: requestedOrderId, amountMinor, status: 'completed' }) }] } as any
          : { docs: [] } as any;
      }
      return { docs: [] } as any;
    });

    const closeSessionSpy = vi.spyOn(tableSessionService, 'closeSession').mockResolvedValue(undefined);

    const result = await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
      restaurantId,
      orderId,
      'CHEF_USER_1'
    );

    expect(result.orderCompleted).toBe(true);
    expect(closeSessionSpy).toHaveBeenCalledWith(
      restaurantId,
      sessionId,
      'CHEF_USER_1',
      expect.objectContaining({ autoCompleteSettledOrders: true })
    );
  });

  it('4. Keeps multi-order session open if one order is paid/completed but second order is still active/unpaid', async () => {
    const order1Id = 'ORD_9004_1';
    const order2Id = 'ORD_9004_2';

    const mockOrder1: Order = {
      id: order1Id,
      restaurantId,
      orderNumber: 'ORD-1',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'served',
      items: [],
      subtotalMinor: 30000,
      discountMinor: 0,
      totalTaxMinor: 1500,
      cgstMinor: 750,
      sgstMinor: 750,
      igstMinor: 0,
      grandTotalMinor: 31500,
      paidAmountMinor: 31500,
      dueAmountMinor: 0,
      paymentStatus: 'paid',
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockOrder2Unpaid: Order = {
      id: order2Id,
      restaurantId,
      orderNumber: 'ORD-2',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'sentToKitchen',
      items: [],
      subtotalMinor: 20000,
      discountMinor: 0,
      totalTaxMinor: 1000,
      cgstMinor: 500,
      sgstMinor: 500,
      igstMinor: 0,
      grandTotalMinor: 21000,
      paidAmountMinor: 0,
      dueAmountMinor: 21000,
      paymentStatus: 'unpaid',
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    paymentAmountsByOrder[order1Id] = 31500;

    const mockKot1: KOT = {
      id: 'KOT_4_1',
      restaurantId,
      kotNumber: 'KOT-4-1',
      orderId: order1Id,
      tableId,
      status: 'served',
      items: [],
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockKot2: KOT = {
      id: 'KOT_4_2',
      restaurantId,
      kotNumber: 'KOT-4-2',
      orderId: order2Id,
      tableId,
      status: 'sentToKitchen',
      items: [],
      createdBy: 'CASHIER_USER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockSessionMulti: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      guestCount: 4,
      openedAt: new Date(),
      activeOrderIds: [order1Id, order2Id],
      openedBy: 'WAITER_1',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async (docRef: any) => {
      if (docRef.path.includes(`orders/${order1Id}`)) {
        return { exists: () => true, data: () => mockOrder1 } as any;
      }
      if (docRef.path.includes(`tableSessions/${sessionId}`)) {
        return { exists: () => true, data: () => mockSessionMulti } as any;
      }
      return { exists: () => false } as any;
    });

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('kots')) {
        const orderIdVal = queryObj.clauses?.find((c: any) => c.field === 'orderId')?.val;
        if (orderIdVal === order1Id) {
          return { docs: [{ id: 'KOT_4_1', data: () => mockKot1 }] } as any;
        }
        if (orderIdVal === order2Id) {
          return { docs: [{ id: 'KOT_4_2', data: () => mockKot2 }] } as any;
        }
      }
      if (queryObj.colRef?.path?.includes('orders')) {
        return {
          docs: [
            { id: order1Id, data: () => mockOrder1 },
            { id: order2Id, data: () => mockOrder2Unpaid }
          ]
        } as any;
      }
      if (queryObj.colRef?.path?.includes('payments')) {
        const requestedOrderId = queryObj.clauses?.find((clause: any) => clause.field === 'orderId')?.val;
        const amountMinor = requestedOrderId ? paymentAmountsByOrder[requestedOrderId] : undefined;
        return amountMinor
          ? { docs: [{ id: 'PAY-' + requestedOrderId, data: () => ({ id: 'PAY-' + requestedOrderId, orderId: requestedOrderId, amountMinor, status: 'completed' }) }] } as any
          : { docs: [] } as any;
      }
      return { docs: [] } as any;
    });

    const closeSessionSpy = vi.spyOn(tableSessionService, 'closeSession');

    const result = await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
      restaurantId,
      order1Id,
      'CASHIER_USER_1'
    );

    expect(result.orderCompleted).toBe(true);
    expect(result.sessionClosed).toBe(false);
    expect(closeSessionSpy).not.toHaveBeenCalled();
  });
});
