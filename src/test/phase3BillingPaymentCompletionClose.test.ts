import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService } from '../services/paymentService';
import { OrderService } from '../services/orderService';
import { TableSessionService } from '../services/tableSessionService';
import { calculateOrderSettlement } from '../domain/settlement';
import { calculateOrderTotals } from '../services/orderCalculationService';
import { Order } from '../types/order';
import { Payment } from '../types/payment';
import { TableSession } from '../types/table';
import { KOT } from '../types/kot';
import { CartState } from '../types/cart';

// Mock Firestore SDK
vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn((_db, ...pathSegments) => ({ type: 'collection', path: pathSegments.join('/') })),
    doc: vi.fn((_dbOrCol, ...pathSegments) => {
      const id = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : `mock_id_${Math.random().toString(36).substring(2, 8)}`;
      return { id, path: pathSegments.join('/') };
    }),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
    getDocs: vi.fn().mockResolvedValue({ docs: [], forEach: vi.fn() }),
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
  auth: { currentUser: { uid: 'STAFF_USER_123' } }
}));

// Mock permissions
vi.mock('../utils/permissions', () => ({
  enforcePermission: vi.fn().mockResolvedValue(true),
  hasPermission: vi.fn().mockReturnValue(true)
}));

import * as firestore from 'firebase/firestore';

describe('RESTAURANTOS — PHASE 3 CORE FLOW HARDENING', () => {
  let paymentService: PaymentService;
  let orderService: OrderService;
  let tableSessionService: TableSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    paymentService = new PaymentService();
    orderService = new OrderService();
    tableSessionService = new TableSessionService();
  });

  describe('1. BILLING & HISTORICAL CALCULATION INTEGRITY', () => {
    it('calculates bill from historical snapshot prices using integer minor units (paise)', () => {
      const totals = calculateOrderTotals({
        items: [
          {
            unitPriceMinor: 35000, // ₹350.00 in paise
            taxRate: 5,
            taxInclusive: false,
            quantity: 2
          }
        ],
        orderDiscount: {
          type: 'fixed',
          fixedAmountMinor: 5000 // ₹50.00 discount
        },
        taxJurisdiction: 'intraState'
      });

      // Item total: 2 * 35000 = 70000 paise (₹700.00)
      expect(totals.subtotalMinor).toBe(70000);
      // Discount: 5000 paise (₹50.00)
      expect(totals.discountMinor).toBe(5000);
      // Taxable: 65000 paise
      expect(totals.taxableAmountMinor).toBe(65000);
      // Intra-state GST 5%: CGST 2.5% (1625 paise) + SGST 2.5% (1625 paise) = 3250 paise
      expect(totals.cgstMinor).toBe(1625);
      expect(totals.sgstMinor).toBe(1625);
      expect(totals.igstMinor).toBe(0);
      expect(totals.totalTaxMinor).toBe(3250);
      // Grand Total: 65000 + 3250 = 68250 paise (₹682.50)
      expect(totals.grandTotalMinor).toBe(68250);
    });

    it('calculates inter-state IGST where applicable', () => {
      const totals = calculateOrderTotals({
        items: [
          {
            unitPriceMinor: 20000, // ₹200.00
            taxRate: 18,
            taxInclusive: false,
            quantity: 1
          }
        ],
        orderDiscount: {
          type: 'percentage',
          percentageRate: 10
        },
        taxJurisdiction: 'interState'
      });

      // Subtotal: 20000 paise (₹200)
      expect(totals.subtotalMinor).toBe(20000);
      // Discount 10%: 2000 paise
      expect(totals.discountMinor).toBe(2000);
      // Taxable: 18000 paise
      expect(totals.taxableAmountMinor).toBe(18000);
      // Inter-state IGST 18%: 3240 paise
      expect(totals.cgstMinor).toBe(0);
      expect(totals.sgstMinor).toBe(0);
      expect(totals.igstMinor).toBe(3240);
      expect(totals.grandTotalMinor).toBe(21240);
    });

    it('never recalculates historical orders from changed current menu prices', () => {
      const historicalOrder: Pick<Order, 'id' | 'restaurantId' | 'grandTotalMinor'> = {
        id: 'ord_hist_01',
        restaurantId: 'REST_PHASE3',
        grandTotalMinor: 50000 // ₹500.00 historical snapshot
      };

      const payments: Payment[] = [
        {
          id: 'pay_01',
          restaurantId: 'REST_PHASE3',
          orderId: 'ord_hist_01',
          amountMinor: 50000,
          method: 'upi',
          status: 'completed',
          createdBy: 'STAFF_1',
          createdAt: new Date()
        }
      ];

      const settlement = calculateOrderSettlement(historicalOrder, payments);
      expect(settlement.grandTotalMinor).toBe(50000);
      expect(settlement.paidAmountMinor).toBe(50000);
      expect(settlement.dueAmountMinor).toBe(0);
      expect(settlement.isFullySettled).toBe(true);
    });
  });

  describe('2. RECEIVE PAYMENT & TRANSACTIONAL SETTLEMENT', () => {
    it('rejects zero or negative payment amounts', async () => {
      await expect(
        paymentService.recordPayment('REST_PHASE3', {
          orderId: 'ord_1',
          amountMinor: 0,
          method: 'cash'
        })
      ).rejects.toThrow(/amountMinor must be an integer minor unit greater than 0/i);

      await expect(
        paymentService.recordPayment('REST_PHASE3', {
          orderId: 'ord_1',
          amountMinor: -5000,
          method: 'cash'
        })
      ).rejects.toThrow(/amountMinor must be an integer minor unit greater than 0/i);
    });

    it('rejects payment attempting to exceed order grand total (overpayment prevention)', async () => {
      const mockOrder: Order = {
        id: 'ord_overpay',
        restaurantId: 'REST_PHASE3',
        orderNumber: 'ORD-100',
        orderType: 'dineIn',
        source: 'pos',
        status: 'served',
        paymentStatus: 'unpaid',
        items: [],
        itemCount: 1,
        subtotalMinor: 50000,
        discountMinor: 0,
        taxableSubtotalMinor: 50000,
        taxMinor: 2500,
        cgstMinor: 1250,
        sgstMinor: 1250,
        igstMinor: 0,
        grandTotalMinor: 52500, // ₹525.00
        paidAmountMinor: 30000, // already paid ₹300.00 (₹225 due)
        dueAmountMinor: 22500,
        taxJurisdiction: 'intra_state',
        currency: 'INR',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'STAFF_1',
        updatedBy: 'STAFF_1'
      };

      (firestore.runTransaction as any).mockImplementationOnce(async (_db: any, callback: any) => {
        const mockTx = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => mockOrder
          }),
          set: vi.fn(),
          update: vi.fn()
        };
        return callback(mockTx);
      });

      // Attempting to pay ₹300.00 (30000 paise) when only ₹225.00 is due
      await expect(
        paymentService.recordPayment('REST_PHASE3', {
          orderId: 'ord_overpay',
          amountMinor: 30000,
          method: 'card'
        })
      ).rejects.toThrow(/Overpayment rejected/i);
    });

    it('records valid payment, updates paidAmountMinor, dueAmountMinor, and sets paymentStatus to paid', async () => {
      const mockOrder: Order = {
        id: 'ord_settle',
        restaurantId: 'REST_PHASE3',
        orderNumber: 'ORD-200',
        orderType: 'dineIn',
        source: 'pos',
        status: 'served',
        paymentStatus: 'unpaid',
        items: [],
        itemCount: 1,
        subtotalMinor: 40000,
        discountMinor: 0,
        taxableSubtotalMinor: 40000,
        taxMinor: 2000,
        cgstMinor: 1000,
        sgstMinor: 1000,
        igstMinor: 0,
        grandTotalMinor: 42000, // ₹420.00
        paidAmountMinor: 0,
        dueAmountMinor: 42000,
        taxJurisdiction: 'intra_state',
        currency: 'INR',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'STAFF_1',
        updatedBy: 'STAFF_1'
      };

      let capturedOrderUpdate: any = null;
      let capturedPaymentDoc: any = null;

      (firestore.runTransaction as any).mockImplementationOnce(async (_db: any, callback: any) => {
        const mockTx = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => mockOrder
          }),
          set: vi.fn().mockImplementation((_ref: any, data: any) => {
            capturedPaymentDoc = data;
          }),
          update: vi.fn().mockImplementation((_ref: any, data: any) => {
            capturedOrderUpdate = data;
          })
        };
        return callback(mockTx);
      });

      const payment = await paymentService.recordPayment('REST_PHASE3', {
        orderId: 'ord_settle',
        amountMinor: 42000,
        method: 'upi',
        reference: 'UPI/123456789'
      });

      expect(payment.amountMinor).toBe(42000);
      expect(payment.status).toBe('completed');
      expect(capturedPaymentDoc.amountMinor).toBe(42000);
      expect(capturedOrderUpdate.paidAmountMinor).toBe(42000);
      expect(capturedOrderUpdate.dueAmountMinor).toBe(0);
      expect(capturedOrderUpdate.paymentStatus).toBe('paid');
    });

    it('correctly calculates split payments across Cash and UPI', () => {
      const order: Pick<Order, 'id' | 'restaurantId' | 'grandTotalMinor'> = {
        id: 'ord_split',
        restaurantId: 'REST_PHASE3',
        grandTotalMinor: 100000 // ₹1,000.00
      };

      const splitPayments: Payment[] = [
        {
          id: 'pay_1',
          restaurantId: 'REST_PHASE3',
          orderId: 'ord_split',
          amountMinor: 60000, // ₹600.00 Cash
          method: 'cash',
          status: 'completed',
          createdBy: 'STAFF_1',
          createdAt: new Date()
        },
        {
          id: 'pay_2',
          restaurantId: 'REST_PHASE3',
          orderId: 'ord_split',
          amountMinor: 40000, // ₹400.00 UPI
          method: 'upi',
          status: 'completed',
          createdBy: 'STAFF_1',
          createdAt: new Date()
        }
      ];

      const settlement = calculateOrderSettlement(order, splitPayments);
      expect(settlement.paidAmountMinor).toBe(100000);
      expect(settlement.dueAmountMinor).toBe(0);
      expect(settlement.isFullySettled).toBe(true);
      expect(settlement.settlementStatus).toBe('fully_paid');
    });
  });

  describe('3. ORDER COMPLETION RULES', () => {
    it('rejects completing an order with outstanding due balance', async () => {
      const mockOrder: Order = {
        id: 'ord_unpaid_comp',
        restaurantId: 'REST_PHASE3',
        orderNumber: 'ORD-300',
        orderType: 'dineIn',
        source: 'pos',
        status: 'served',
        paymentStatus: 'partially_paid',
        items: [],
        itemCount: 1,
        subtotalMinor: 50000,
        discountMinor: 0,
        taxableSubtotalMinor: 50000,
        taxMinor: 2500,
        cgstMinor: 1250,
        sgstMinor: 1250,
        igstMinor: 0,
        grandTotalMinor: 52500,
        paidAmountMinor: 30000,
        dueAmountMinor: 22500, // Outstanding due ₹225.00
        taxJurisdiction: 'intra_state',
        currency: 'INR',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'STAFF_1',
        updatedBy: 'STAFF_1'
      };

      (firestore.getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => mockOrder
      });

      await expect(
        orderService.completeOrder('REST_PHASE3', 'ord_unpaid_comp', 'STAFF_1')
      ).rejects.toThrow(/Outstanding due of ₹225.00 must be settled before completion/i);
    });

    it('rejects completing an order if active in-progress KOTs exist', async () => {
      const mockOrder: Order = {
        id: 'ord_active_kot',
        restaurantId: 'REST_PHASE3',
        orderNumber: 'ORD-301',
        orderType: 'dineIn',
        source: 'pos',
        status: 'ready',
        paymentStatus: 'paid',
        items: [],
        itemCount: 1,
        subtotalMinor: 50000,
        discountMinor: 0,
        taxableSubtotalMinor: 50000,
        taxMinor: 2500,
        cgstMinor: 1250,
        sgstMinor: 1250,
        igstMinor: 0,
        grandTotalMinor: 52500,
        paidAmountMinor: 52500,
        dueAmountMinor: 0,
        taxJurisdiction: 'intra_state',
        currency: 'INR',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'STAFF_1',
        updatedBy: 'STAFF_1'
      };

      (firestore.getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => mockOrder
      });

      const activeKOT: KOT = {
        id: 'kot_active_1',
        kotNumber: 'KOT-101',
        restaurantId: 'REST_PHASE3',
        orderId: 'ord_active_kot',
        orderNumber: 'ORD-301',
        orderType: 'dineIn',
        items: [],
        status: 'preparing', // In-progress kitchen ticket!
        createdBy: 'STAFF_1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [
          {
            id: 'kot_active_1',
            data: () => activeKOT
          }
        ]
      });

      await expect(
        orderService.completeOrder('REST_PHASE3', 'ord_active_kot', 'STAFF_1')
      ).rejects.toThrow(/KOT "KOT-101" is still in status "preparing"/i);
    });

    it('successfully completes fully settled order with all served KOTs', async () => {
      const mockOrder: Order = {
        id: 'ord_complete_ok',
        restaurantId: 'REST_PHASE3',
        orderNumber: 'ORD-302',
        orderType: 'dineIn',
        source: 'pos',
        status: 'served',
        paymentStatus: 'paid',
        items: [],
        itemCount: 1,
        subtotalMinor: 50000,
        discountMinor: 0,
        taxableSubtotalMinor: 50000,
        taxMinor: 2500,
        cgstMinor: 1250,
        sgstMinor: 1250,
        igstMinor: 0,
        grandTotalMinor: 52500,
        paidAmountMinor: 52500,
        dueAmountMinor: 0,
        taxJurisdiction: 'intra_state',
        currency: 'INR',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'STAFF_1',
        updatedBy: 'STAFF_1'
      };

      (firestore.getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => mockOrder
      });

      const servedKOT: KOT = {
        id: 'kot_served_1',
        kotNumber: 'KOT-102',
        restaurantId: 'REST_PHASE3',
        orderId: 'ord_complete_ok',
        orderNumber: 'ORD-302',
        orderType: 'dineIn',
        items: [],
        status: 'served', // Terminal kitchen ticket
        createdBy: 'STAFF_1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // KOTs query
      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [{ id: 'kot_served_1', data: () => servedKOT }]
      });

      // Payments query
      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [
          {
            id: 'pay_ok',
            data: () => ({ id: 'pay_ok', status: 'completed' })
          }
        ]
      });

      let updatedDocPayload: any = null;
      (firestore.updateDoc as any).mockImplementationOnce((_ref: any, data: any) => {
        updatedDocPayload = data;
      });

      const completed = await orderService.completeOrder('REST_PHASE3', 'ord_complete_ok', 'STAFF_1');
      expect(completed.status).toBe('completed');
      expect(updatedDocPayload.status).toBe('completed');
      expect(updatedDocPayload.paymentStatus).toBe('paid');
    });
  });

  describe('4. TABLE SESSION CLOSURE RULES', () => {
    it('rejects closing table session if an order is unpaid', async () => {
      const mockSession: TableSession = {
        id: 'session_close_fail',
        restaurantId: 'REST_PHASE3',
        tableId: 'table_10',
        status: 'open',
        guestCount: 2,
        openedAt: new Date(),
        activeOrderIds: ['ord_unpaid_sess'],
        openedBy: 'STAFF_1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (firestore.getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => mockSession
      });

      // Orders for this session
      const unpaidOrder: Partial<Order> = {
        id: 'ord_unpaid_sess',
        orderNumber: 'ORD-400',
        status: 'completed',
        grandTotalMinor: 50000,
        paidAmountMinor: 20000,
        dueAmountMinor: 30000 // Unpaid balance ₹300.00
      };

      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [{ id: 'ord_unpaid_sess', data: () => unpaidOrder }]
      });

      await expect(
        tableSessionService.closeSession('REST_PHASE3', 'session_close_fail', 'STAFF_1')
      ).rejects.toThrow(/has an unpaid balance of ₹300.00/i);
    });

    it('rejects closing table session if an order is still in progress (e.g. preparing)', async () => {
      const mockSession: TableSession = {
        id: 'session_in_prog',
        restaurantId: 'REST_PHASE3',
        tableId: 'table_10',
        status: 'open',
        guestCount: 2,
        openedAt: new Date(),
        activeOrderIds: ['ord_in_prog'],
        openedBy: 'STAFF_1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (firestore.getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => mockSession
      });

      const inProgressOrder: Partial<Order> = {
        id: 'ord_in_prog',
        orderNumber: 'ORD-401',
        status: 'preparing', // Not completed or cancelled!
        grandTotalMinor: 50000,
        paidAmountMinor: 50000,
        dueAmountMinor: 0
      };

      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [{ id: 'ord_in_prog', data: () => inProgressOrder }]
      });

      await expect(
        tableSessionService.closeSession('REST_PHASE3', 'session_in_prog', 'STAFF_1')
      ).rejects.toThrow(/is still in status "preparing". Orders must be completed or cancelled/i);
    });

    it('successfully closes table session and clears activeSessionId from physical table', async () => {
      const mockSession: TableSession = {
        id: 'session_ok',
        restaurantId: 'REST_PHASE3',
        tableId: 'table_10',
        status: 'open',
        guestCount: 4,
        openedAt: new Date('2026-09-11T10:00:00Z'),
        activeOrderIds: ['ord_done'],
        openedBy: 'STAFF_1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (firestore.getDoc as any).mockResolvedValueOnce({
        exists: () => true,
        data: () => mockSession
      });

      const completedOrder: Partial<Order> = {
        id: 'ord_done',
        orderNumber: 'ORD-402',
        status: 'completed',
        grandTotalMinor: 80000,
        paidAmountMinor: 80000,
        dueAmountMinor: 0
      };

      // Session orders query
      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [{ id: 'ord_done', data: () => completedOrder }]
      });

      // KOTs for ord_done
      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [{ id: 'kot_done', data: () => ({ id: 'kot_done', status: 'served' }) }]
      });

      // Payments for ord_done
      (firestore.getDocs as any).mockResolvedValueOnce({
        docs: [{ id: 'pay_done', data: () => ({ id: 'pay_done', status: 'completed' }) }]
      });

      let updatedSessionPayload: any = null;
      let updatedTablePayload: any = null;

      (firestore.runTransaction as any).mockImplementationOnce(async (_db: any, callback: any) => {
        const mockTx = {
          get: vi.fn().mockImplementation((ref: any) => {
            if (ref.path.includes('tableSessions')) {
              return { exists: () => true, data: () => mockSession };
            }
            if (ref.path.includes('tables')) {
              return {
                exists: () => true,
                data: () => ({ id: 'table_10', activeSessionId: 'session_ok' })
              };
            }
            return { exists: () => false };
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path.includes('tableSessions')) {
              updatedSessionPayload = data;
            }
            if (ref.path.includes('tables')) {
              updatedTablePayload = data;
            }
          })
        };
        return callback(mockTx);
      });

      await tableSessionService.closeSession('REST_PHASE3', 'session_ok', 'STAFF_1');

      expect(updatedSessionPayload.status).toBe('closed');
      expect(updatedTablePayload.activeSessionId).toBe(null);
    });
  });

  describe('5. REFUND FLOW (AUDITABLE & NON-DESTRUCTIVE)', () => {
    it('refunds payment, updates order paidAmount and dueAmount, without deleting records', async () => {
      const mockPayment: Payment = {
        id: 'pay_refund_1',
        restaurantId: 'REST_PHASE3',
        orderId: 'ord_refund_target',
        amountMinor: 25000, // ₹250.00
        method: 'card',
        status: 'completed',
        createdBy: 'STAFF_1',
        createdAt: new Date()
      };

      const mockOrder: Order = {
        id: 'ord_refund_target',
        restaurantId: 'REST_PHASE3',
        orderNumber: 'ORD-500',
        orderType: 'dineIn',
        source: 'pos',
        status: 'completed',
        paymentStatus: 'paid',
        items: [],
        itemCount: 1,
        subtotalMinor: 25000,
        discountMinor: 0,
        taxableSubtotalMinor: 25000,
        taxMinor: 0,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
        grandTotalMinor: 25000,
        paidAmountMinor: 25000,
        dueAmountMinor: 0,
        taxJurisdiction: 'intra_state',
        currency: 'INR',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'STAFF_1',
        updatedBy: 'STAFF_1'
      };

      let updatedPaymentPayload: any = null;
      let updatedOrderPayload: any = null;

      (firestore.runTransaction as any).mockImplementationOnce(async (_db: any, callback: any) => {
        const mockTx = {
          get: vi.fn().mockImplementation((ref: any) => {
            if (ref.path.includes('payments')) {
              return { exists: () => true, data: () => mockPayment };
            }
            if (ref.path.includes('orders')) {
              return { exists: () => true, data: () => mockOrder };
            }
            return { exists: () => false };
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path.includes('payments')) {
              updatedPaymentPayload = data;
            }
            if (ref.path.includes('orders')) {
              updatedOrderPayload = data;
            }
          })
        };
        return callback(mockTx);
      });

      await paymentService.refundPayment(
        'REST_PHASE3',
        'pay_refund_1',
        'MANAGER_1',
        'Customer returned item'
      );

      expect(updatedPaymentPayload.status).toBe('refunded');
      expect(updatedPaymentPayload.refundReason).toBe('Customer returned item');
      expect(updatedOrderPayload.paidAmountMinor).toBe(0);
      expect(updatedOrderPayload.dueAmountMinor).toBe(25000);
      expect(updatedOrderPayload.paymentStatus).toBe('unpaid');
    });
  });
});
