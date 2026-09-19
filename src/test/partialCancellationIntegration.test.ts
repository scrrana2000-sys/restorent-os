import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kotService } from '../services/kotService';
import { orderService } from '../services/orderService';
import { stockConsumptionService } from '../services/stockConsumptionService';
import { auditService } from '../services/auditService';

// Mock Firebase Firestore SDK
vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn((_db, ...pathSegments) => ({ type: 'collection', path: pathSegments.join('/') })),
    doc: vi.fn((_dbOrCol, ...pathSegments) => {
      const id = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : `mock_id_${Math.random().toString(36).substring(2, 8)}`;
      return { id, path: pathSegments.join('/') };
    }),
    getDoc: vi.fn().mockResolvedValue({
      exists: () => false,
      data: () => null
    }),
    getDocs: vi.fn().mockResolvedValue({
      empty: true,
      docs: []
    }),
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    runTransaction: vi.fn(async (_db, cb) => {
      const mockTx = {
        get: async (ref: any) => vi.mocked(firestore.getDoc)(ref),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      };
      return await cb(mockTx);
    }),
    query: vi.fn((colRef, ...clauses) => ({ type: 'query', colRef, clauses })),
    where: vi.fn((field, op, val) => ({ type: 'where', field, op, val })),
    orderBy: vi.fn((field, dir) => ({ type: 'orderBy', field, dir })),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(() => new Date('2026-09-12T12:00:00Z'))
  };
});

vi.mock('../config/firebase', () => ({
  db: { type: 'mockDb' },
  auth: { currentUser: { uid: 'CHEF_USER_99' } }
}));

vi.mock('../services/permissionService', () => ({
  enforcePermission: vi.fn().mockResolvedValue(true)
}));

vi.mock('../services/stockConsumptionService', () => ({
  stockConsumptionService: {
    reversePartialStockConsumption: vi.fn().mockResolvedValue({ reversedMovements: [], affectedConsumptions: [] })
  }
}));

vi.mock('../services/auditService', () => ({
  auditService: {
    logEvent: vi.fn().mockResolvedValue(true)
  }
}));

describe('Partial Item / Quantity Cancellation Engine', () => {
  const mockRestaurantId = 'REST_TEST_101';
  const mockKotId = 'kot_test_101';
  const mockOrderId = 'order_test_101';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('partially cancels 5 of 10 items in OrderService, preserving originalQuantity and updating financial totals', async () => {
    const existingOrder = {
      id: mockOrderId,
      restaurantId: mockRestaurantId,
      orderNumber: 'ORD-001',
      status: 'sentToKitchen',
      source: 'pos',
      orderType: 'dineIn',
      taxInclusive: false,
      items: [
        {
          itemId: 'item_biryani',
          nameSnapshot: 'Veg Biryani',
          shortNameSnapshot: 'V Biryani',
          quantity: 10,
          originalQuantity: 10,
          cancelledQuantity: 0,
          unitPriceMinor: 10000, // ₹100.00
          taxRate: 5,
          taxInclusive: false,
          discountMinor: 0,
          lineSubtotalMinor: 100000, // ₹1000.00
          lineTaxMinor: 5000, // ₹50.00
          lineTotalMinor: 105000 // ₹1050.00
        }
      ],
      subtotalMinor: 100000,
      discountMinor: 0,
      taxableAmountMinor: 100000,
      cgstMinor: 2500,
      sgstMinor: 2500,
      igstMinor: 0,
      totalTaxMinor: 5000,
      grandTotalMinor: 105000,
      paidAmountMinor: 0,
      dueAmountMinor: 105000,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'CHEF_USER_99'
    };

    vi.spyOn(orderService, 'getOrderById').mockResolvedValue(existingOrder as any);

    const updatedOrder = await orderService.partiallyCancelOrderItems(
      mockRestaurantId,
      mockOrderId,
      [
        {
          itemId: 'item_biryani',
          cancelledQuantity: 5,
          reason: 'Kitchen only has 5 available'
        }
      ],
      'CHEF_USER_99'
    );

    expect(updatedOrder).toBeDefined();
    expect(updatedOrder.items[0].quantity).toBe(5);
    expect(updatedOrder.items[0].originalQuantity).toBe(10);
    expect(updatedOrder.items[0].cancelledQuantity).toBe(5);
    expect(updatedOrder.items[0].cancellationReason).toBe('Kitchen only has 5 available');

    // Recalculated totals for remaining 5 items @ ₹100 + 5% tax = ₹500 + ₹25 tax = ₹525
    expect(updatedOrder.subtotalMinor).toBe(50000);
    expect(updatedOrder.totalTaxMinor).toBe(2500);
    expect(updatedOrder.grandTotalMinor).toBe(52500);
    expect(updatedOrder.dueAmountMinor).toBe(52500);

    // Stock compensating reversal triggered with proper signature
    expect(stockConsumptionService.reversePartialStockConsumption).toHaveBeenCalledWith(
      mockRestaurantId,
      mockOrderId,
      [
        {
          itemId: 'item_biryani',
          cancelledQuantity: 5
        }
      ],
      'Kitchen only has 5 available',
      'CHEF_USER_99',
      undefined
    );
  });

  it('partially cancels KOT items and synchronizes changes to parent Order', async () => {
    const existingKot = {
      id: mockKotId,
      kotNumber: 'KOT-001',
      restaurantId: mockRestaurantId,
      orderId: mockOrderId,
      status: 'preparing',
      items: [
        {
          itemId: 'item_biryani',
          nameSnapshot: 'Veg Biryani',
          shortNameSnapshot: 'V Biryani',
          quantity: 10,
          originalQuantity: 10,
          cancelledQuantity: 0
        }
      ],
      createdAt: new Date(),
      createdBy: 'CHEF_USER_99'
    };

    vi.spyOn(kotService, 'getKOTById').mockResolvedValue(existingKot as any);
    const partiallyCancelOrderItemsSpy = vi.spyOn(orderService, 'partiallyCancelOrderItems').mockResolvedValue({
      id: mockOrderId,
      items: []
    } as any);

    const updatedKot = await kotService.partiallyCancelKOTItems(
      mockRestaurantId,
      mockKotId,
      [
        {
          itemId: 'item_biryani',
          cancelledQuantity: 5,
          reason: 'Item Out of Stock'
        }
      ],
      'CHEF_USER_99',
      'idemp_kot_key_123'
    );

    expect(updatedKot.items[0].quantity).toBe(5);
    expect(updatedKot.items[0].originalQuantity).toBe(10);
    expect(updatedKot.items[0].cancelledQuantity).toBe(5);
    expect(updatedKot.status).toBe('preparing'); // Status remains preparing as active items remain

    expect(partiallyCancelOrderItemsSpy).toHaveBeenCalledWith(
      mockRestaurantId,
      mockOrderId,
      [
        {
          itemId: 'item_biryani',
          cancelledQuantity: 5,
          reason: 'Item Out of Stock'
        }
      ],
      'CHEF_USER_99',
      'idemp_kot_key_123_order_sync'
    );
  });
});
