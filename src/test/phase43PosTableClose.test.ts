import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tableSessionService } from '../services/tableSessionService';
import { auditService } from '../services/auditService';
import { enforcePermission } from '../utils/permissions';
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
    query: vi.fn((colRef, ..._clauses) => ({ type: 'query', colRef })),
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
  auth: { currentUser: { uid: 'POS_CASHIER_01' } }
}));

// Mock permissions
vi.mock('../utils/permissions', () => ({
  enforcePermission: vi.fn().mockResolvedValue(true),
  hasPermission: vi.fn().mockReturnValue(true)
}));

import * as firestore from 'firebase/firestore';

describe('PHASE 4.3 ADDITION: POS TABLE CLOSE / RELEASE CONTROL TEST SUITE', () => {
  const restaurantId = 'REST_POS_CLOSE_01';
  const tableId = 'TBL_202';
  const sessionId = 'SESS_POS_9001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. POS Manual Table Close succeeds on fully paid and served order', async () => {
    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      openedAt: new Date(),
      guestCount: 2,
      openedBy: 'POS_CASHIER_01',
      activeOrderIds: ['ORD_101'],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockOrder: Order = {
      id: 'ORD_101',
      restaurantId,
      orderNumber: 'ORD-101',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'completed',
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
      createdBy: 'POS_CASHIER_01',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockKot: KOT = {
      id: 'KOT_101',
      restaurantId,
      orderId: 'ORD_101',
      kotNumber: 'KOT-1',
      tableId,
      tableSessionId: sessionId,
      items: [],
      status: 'served',
      createdBy: 'POS_CASHIER_01',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async (docRef: any) => {
      if (docRef.path.includes(`tableSessions/${sessionId}`)) {
        return {
          exists: () => true,
          data: () => mockSession
        } as any;
      }
      return { exists: () => false } as any;
    });

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('orders')) {
        return {
          docs: [{ id: 'ORD_101', data: () => mockOrder }],
          forEach: (cb: any) => cb({ id: 'ORD_101', data: () => mockOrder })
        } as any;
      }
      if (queryObj.colRef?.path?.includes('kots')) {
        return {
          docs: [{ id: 'KOT_101', data: () => mockKot }],
          forEach: (cb: any) => cb({ id: 'KOT_101', data: () => mockKot })
        } as any;
      }
      if (queryObj.colRef?.path?.includes('payments')) {
        return { docs: [], forEach: () => {} } as any;
      }
      return { docs: [], forEach: () => {} } as any;
    });

    let txUpdatedTableDoc = false;
    let txClosedSessionDoc = false;

    vi.spyOn(firestore, 'runTransaction').mockImplementation(async (_db: any, callback: any) => {
      const mockTx = {
        get: vi.fn().mockImplementation(async (ref: any) => {
          if (ref.path.includes(`tableSessions/${sessionId}`)) {
            return { exists: () => true, data: () => mockSession };
          }
          if (ref.path.includes(`tables/${tableId}`)) {
            return { exists: () => true, data: () => ({ id: tableId, activeSessionId: sessionId, status: 'occupied' }) };
          }
          return { exists: () => false };
        }),
        update: vi.fn().mockImplementation((ref: any, data: any) => {
          if (ref.path.includes(`tableSessions/${sessionId}`)) {
            expect(data.status).toBe('closed');
            txClosedSessionDoc = true;
          }
          if (ref.path.includes(`tables/${tableId}`)) {
            expect(data.activeSessionId).toBeNull();
            expect(data.status).toBe('available');
            txUpdatedTableDoc = true;
          }
        }),
        set: vi.fn()
      };
      return callback(mockTx);
    });

    await tableSessionService.closeSession(restaurantId, sessionId, 'POS_CASHIER_01', {
      autoCompleteSettledOrders: true,
      source: 'pos_manual'
    });

    expect(txClosedSessionDoc).toBe(true);
    expect(txUpdatedTableDoc).toBe(true);

    // Verify Audit Event
    expect(auditService.logEvent).toHaveBeenCalledWith(restaurantId, expect.objectContaining({
      entityType: 'tableSession',
      entityId: sessionId,
      action: 'session_closed',
      actorUid: 'POS_CASHIER_01',
      metadata: expect.objectContaining({
        tableId,
        source: 'pos_manual'
      })
    }));
  });

  it('2. POS Close with Unpaid Balance throws clear error', async () => {
    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      openedAt: new Date(),
      guestCount: 2,
      openedBy: 'POS_CASHIER_01',
      activeOrderIds: ['ORD_UNPAID'],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockUnpaidOrder: Order = {
      id: 'ORD_UNPAID',
      restaurantId,
      orderNumber: 'ORD-UNPAID',
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
      paidAmountMinor: 0,
      dueAmountMinor: 52500,
      paymentStatus: 'unpaid',
      createdBy: 'POS_CASHIER_01',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async () => ({
      exists: () => true,
      data: () => mockSession
    }) as any);

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('orders')) {
        return { docs: [{ id: 'ORD_UNPAID', data: () => mockUnpaidOrder }] } as any;
      }
      return { docs: [] } as any;
    });

    await expect(
      tableSessionService.closeSession(restaurantId, sessionId, 'POS_CASHIER_01', {
        autoCompleteSettledOrders: true,
        source: 'pos_manual'
      })
    ).rejects.toThrow(/unpaid balance of ₹525\.00/i);
  });

  it('3. POS Close with Active KOT (preparing) throws clear error', async () => {
    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      openedAt: new Date(),
      guestCount: 2,
      openedBy: 'POS_CASHIER_01',
      activeOrderIds: ['ORD_PREPARING'],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockSettledOrder: Order = {
      id: 'ORD_PREPARING',
      restaurantId,
      orderNumber: 'ORD-PREP',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'preparing',
      items: [],
      subtotalMinor: 10000,
      discountMinor: 0,
      totalTaxMinor: 500,
      cgstMinor: 250,
      sgstMinor: 250,
      igstMinor: 0,
      grandTotalMinor: 10500,
      paidAmountMinor: 10500,
      dueAmountMinor: 0,
      paymentStatus: 'paid',
      createdBy: 'POS_CASHIER_01',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockActiveKot: KOT = {
      id: 'KOT_PREP',
      restaurantId,
      orderId: 'ORD_PREPARING',
      kotNumber: 'KOT-PREP-1',
      tableId,
      tableSessionId: sessionId,
      items: [],
      status: 'preparing',
      createdBy: 'POS_CASHIER_01',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async () => ({
      exists: () => true,
      data: () => mockSession
    }) as any);

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('orders')) {
        return { docs: [{ id: 'ORD_PREPARING', data: () => mockSettledOrder }] } as any;
      }
      if (queryObj.colRef?.path?.includes('kots')) {
        return { docs: [{ id: 'KOT_PREP', data: () => mockActiveKot }] } as any;
      }
      return { docs: [] } as any;
    });

    await expect(
      tableSessionService.closeSession(restaurantId, sessionId, 'POS_CASHIER_01', {
        autoCompleteSettledOrders: true,
        source: 'pos_manual'
      })
    ).rejects.toThrow(/kitchen orders must be served or cancelled/i);
  });

  it('4. Multi-order session with one unpaid order blocks POS table closure', async () => {
    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      openedAt: new Date(),
      guestCount: 3,
      openedBy: 'POS_CASHIER_01',
      activeOrderIds: ['ORD_MULTI_1', 'ORD_MULTI_2'],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockOrder1: Order = {
      id: 'ORD_MULTI_1',
      restaurantId,
      orderNumber: 'ORD-M1',
      orderType: 'dineIn',
      source: 'pos',
      tableId,
      tableSessionId: sessionId,
      status: 'completed',
      items: [],
      subtotalMinor: 20000,
      discountMinor: 0,
      totalTaxMinor: 1000,
      cgstMinor: 500,
      sgstMinor: 500,
      igstMinor: 0,
      grandTotalMinor: 21000,
      paidAmountMinor: 21000,
      dueAmountMinor: 0,
      paymentStatus: 'paid',
      createdBy: 'POS_CASHIER_01',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockOrder2: Order = {
      id: 'ORD_MULTI_2',
      restaurantId,
      orderNumber: 'ORD-M2',
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
      paidAmountMinor: 0,
      dueAmountMinor: 31500,
      paymentStatus: 'unpaid',
      createdBy: 'POS_CASHIER_01',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async () => ({
      exists: () => true,
      data: () => mockSession
    }) as any);

    vi.spyOn(firestore, 'getDocs').mockImplementation(async (queryObj: any) => {
      if (queryObj.colRef?.path?.includes('orders')) {
        return { docs: [{ id: 'ORD_MULTI_1', data: () => mockOrder1 }, { id: 'ORD_MULTI_2', data: () => mockOrder2 }] } as any;
      }
      return { docs: [] } as any;
    });

    await expect(
      tableSessionService.closeSession(restaurantId, sessionId, 'POS_CASHIER_01', {
        autoCompleteSettledOrders: true,
        source: 'pos_manual'
      })
    ).rejects.toThrow(/unpaid balance of ₹315\.00/i);
  });

  it('5. POS Close on already closed session is rejected gracefully', async () => {
    const mockClosedSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'closed',
      openedAt: new Date(),
      closedAt: new Date(),
      guestCount: 2,
      openedBy: 'POS_CASHIER_01',
      activeOrderIds: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async () => ({
      exists: () => true,
      data: () => mockClosedSession
    }) as any);

    await expect(
      tableSessionService.closeSession(restaurantId, sessionId, 'POS_CASHIER_01', {
        autoCompleteSettledOrders: true,
        source: 'pos_manual'
      })
    ).rejects.toThrow(/Cannot close session/i);
  });

  it('6. POS Close checks permissions via enforcePermission', async () => {
    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      openedAt: new Date(),
      guestCount: 2,
      openedBy: 'POS_CASHIER_01',
      activeOrderIds: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async () => ({
      exists: () => true,
      data: () => mockSession
    }) as any);

    vi.spyOn(firestore, 'getDocs').mockImplementation(async () => ({ docs: [] }) as any);

    await tableSessionService.closeSession(restaurantId, sessionId, 'POS_CASHIER_01', {
      autoCompleteSettledOrders: true,
      source: 'pos_manual'
    });

    expect(enforcePermission).toHaveBeenCalledWith(restaurantId, 'close_sessions');
  });

  it('7. Concurrency simulation: atomic transaction handles duplicate close calls safely', async () => {
    const mockSession: TableSession = {
      id: sessionId,
      restaurantId,
      tableId,
      status: 'open',
      openedAt: new Date(),
      guestCount: 2,
      openedBy: 'POS_CASHIER_01',
      activeOrderIds: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(firestore, 'getDoc').mockImplementation(async () => ({
      exists: () => true,
      data: () => mockSession
    }) as any);

    vi.spyOn(firestore, 'getDocs').mockImplementation(async () => ({ docs: [] }) as any);

    let transactionCount = 0;
    vi.spyOn(firestore, 'runTransaction').mockImplementation(async (_db: any, callback: any) => {
      transactionCount++;
      const currentStatus = transactionCount === 1 ? 'open' : 'closed';
      const mockTx = {
        get: vi.fn().mockImplementation(async () => ({
          exists: () => true,
          data: () => ({ ...mockSession, status: currentStatus })
        })),
        update: vi.fn(),
        set: vi.fn()
      };
      return callback(mockTx);
    });

    // First call succeeds
    await tableSessionService.closeSession(restaurantId, sessionId, 'POS_CASHIER_01', {
      autoCompleteSettledOrders: true,
      source: 'pos_manual'
    });

    // Concurrent second call fails transaction status check
    await expect(
      tableSessionService.closeSession(restaurantId, sessionId, 'CAPTAIN_01', {
        autoCompleteSettledOrders: true,
        source: 'captain_manual'
      })
    ).rejects.toThrow(/Cannot close session/i);
  });
});
