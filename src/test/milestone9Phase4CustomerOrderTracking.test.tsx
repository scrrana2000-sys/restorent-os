import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  getCustomerStatusDetails,
  validateCustomerOrderAccess,
  sanitizeCustomerOrder,
  getOrderForTracking,
  subscribeToOrderTracking,
  saveTrackedOrder,
  getTrackedOrders,
  getActiveOrdersCount,
  getCustomerOrders
} from '../services/customerOrderTrackingService';
import { Order, OrderStatus } from '../types/order';
import { OrderStatusTimeline } from '../components/customer/OrderStatusTimeline';
import { CustomerOrderTrackingModal } from '../components/customer/CustomerOrderTrackingModal';
import { CustomerMyOrdersModal } from '../components/customer/CustomerMyOrdersModal';
import * as firestore from 'firebase/firestore';

// Mock Firebase Firestore
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: vi.fn((_db, ...pathSegments) => ({
      type: 'docRef',
      path: pathSegments.join('/')
    })),
    getDoc: vi.fn(),
    onSnapshot: vi.fn(),
    collection: vi.fn((_db, ...pathSegments) => ({
      type: 'colRef',
      path: pathSegments.join('/')
    })),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn()
  };
});

// Mock Customer Auth Context
vi.mock('../context/CustomerAuthContext', () => ({
  useCustomerAuth: vi.fn(() => ({
    customer: {
      customerId: 'CUST_AUTH_123',
      name: 'Priya Sharma',
      phone: '9876543210',
      email: 'priya@example.com'
    },
    firebaseUser: { uid: 'CUST_AUTH_123' },
    isAuthenticated: true,
    isLoading: false
  }))
}));

describe('Milestone 9 — Phase 4: Customer Order Tracking Security & Functional Audit', () => {
  const sampleAuthOrder: Order = {
    id: 'ORD_AUTH_001',
    restaurantId: 'REST_ABC',
    orderNumber: 'ORD-101',
    customerId: 'CUST_AUTH_123',
    orderType: 'takeaway',
    source: 'online',
    status: 'preparing',
    items: [
      {
        itemId: 'ITEM_1',
        nameSnapshot: 'Paneer Butter Masala',
        shortNameSnapshot: 'Paneer Butter',
        quantity: 2,
        unitPriceMinor: 25000,
        taxRate: 5,
        taxInclusive: false,
        discountMinor: 0,
        lineSubtotalMinor: 50000,
        lineTaxMinor: 2500,
        lineTotalMinor: 52500,
        notes: 'Extra spicy'
      }
    ],
    itemCount: 2,
    subtotalMinor: 50000,
    discountMinor: 0,
    cgstMinor: 1250,
    sgstMinor: 1250,
    igstMinor: 0,
    totalTaxMinor: 2500,
    taxMinor: 2500,
    grandTotalMinor: 52500,
    paidAmountMinor: 0,
    dueAmountMinor: 52500,
    paymentStatus: 'unpaid',
    notes: 'Please pack quickly',
    customerSnapshot: {
      name: 'Priya Sharma',
      phone: '9876543210',
      email: 'priya@example.com'
    },
    stockConsumptionStatus: 'consumed',
    createdBy: 'STAFF_USER_999',
    createdAt: '2026-09-16T02:00:00.000Z',
    updatedAt: '2026-09-16T02:15:00.000Z'
  };

  const sampleGuestOrder: Order = {
    id: 'ORD_GUEST_002',
    restaurantId: 'REST_ABC',
    orderNumber: 'ORD-102',
    customerId: null,
    orderType: 'delivery',
    source: 'online',
    status: 'confirmed',
    items: [
      {
        itemId: 'ITEM_2',
        nameSnapshot: 'Veg Biryani',
        shortNameSnapshot: 'Veg Biryani',
        quantity: 1,
        unitPriceMinor: 20000,
        taxRate: 5,
        taxInclusive: false,
        discountMinor: 0,
        lineSubtotalMinor: 20000,
        lineTaxMinor: 1000,
        lineTotalMinor: 21000
      }
    ],
    itemCount: 1,
    subtotalMinor: 20000,
    discountMinor: 0,
    cgstMinor: 500,
    sgstMinor: 500,
    igstMinor: 0,
    totalTaxMinor: 1000,
    taxMinor: 1000,
    grandTotalMinor: 21000,
    paidAmountMinor: 0,
    dueAmountMinor: 21000,
    paymentStatus: 'unpaid',
    customerSnapshot: {
      name: 'Rahul Guest',
      phone: '9123456780',
      address: '123 Main St, Indiranagar, Bengaluru'
    },
    stockConsumptionStatus: 'consumed',
    createdBy: 'system',
    createdAt: '2026-09-16T02:10:00.000Z',
    updatedAt: '2026-09-16T02:10:00.000Z'
  };

  const sampleInternalPosOrder: Order = {
    id: 'ORD_POS_003',
    restaurantId: 'REST_ABC',
    orderNumber: 'POS-001',
    customerId: null,
    orderType: 'dineIn',
    source: 'pos',
    status: 'preparing',
    tableId: 'TBL_1',
    tableSessionId: 'SESS_1',
    items: [],
    subtotalMinor: 10000,
    discountMinor: 0,
    cgstMinor: 250,
    sgstMinor: 250,
    igstMinor: 0,
    grandTotalMinor: 10500,
    paidAmountMinor: 0,
    dueAmountMinor: 10500,
    createdBy: 'STAFF_CASHIER_1',
    createdAt: '2026-09-16T02:05:00.000Z',
    updatedAt: '2026-09-16T02:05:00.000Z'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('A & B. Authorization & Data Minimization Checks', () => {
    it('allows authenticated customer to access their own online order', () => {
      expect(() => {
        validateCustomerOrderAccess(sampleAuthOrder, 'CUST_AUTH_123');
      }).not.toThrow();
    });

    it('blocks authenticated customer from accessing another customer’s order', () => {
      expect(() => {
        validateCustomerOrderAccess(sampleAuthOrder, 'CUST_ATTACKER_999');
      }).toThrow(/Unauthorized/i);
    });

    it('blocks unauthenticated access to an authenticated customer’s order', () => {
      expect(() => {
        validateCustomerOrderAccess(sampleAuthOrder, null);
      }).toThrow(/Authentication Required/i);
    });

    it('allows guest to track an unassigned public online order', () => {
      expect(() => {
        validateCustomerOrderAccess(sampleGuestOrder, null);
      }).not.toThrow();
    });

    it('strictly blocks guest/external access to internal POS dineIn orders', () => {
      expect(() => {
        validateCustomerOrderAccess(sampleInternalPosOrder, null);
      }).toThrow(/Order not found or inaccessible/i);
    });

    it('sanitizes order data and excludes internal staff/inventory metadata', () => {
      const sanitized = sanitizeCustomerOrder(sampleAuthOrder);

      // Verify customer-facing data is present
      expect(sanitized.id).toBe('ORD_AUTH_001');
      expect(sanitized.orderNumber).toBe('ORD-101');
      expect(sanitized.grandTotalMinor).toBe(52500);
      expect(sanitized.items[0].nameSnapshot).toBe('Paneer Butter Masala');

      // Verify internal staff metadata is scrubbed/minimized
      expect((sanitized as any).stockConsumptionStatus).toBeUndefined();
      expect((sanitized as any).tableSessionId).toBeUndefined();
      expect(sanitized.createdBy).toBe('system'); // masked
    });
  });

  describe('C & D. Status State Machine & Lifecycle Step Mapping', () => {
    it('correctly maps all canonical OrderStatus values for takeaway orders', () => {
      const confirmedDetails = getCustomerStatusDetails('confirmed', 'takeaway');
      expect(confirmedDetails.currentStepIndex).toBe(0);
      expect(confirmedDetails.label).toBe('Order Placed');
      expect(confirmedDetails.isCancelled).toBe(false);

      const kitchenDetails = getCustomerStatusDetails('sentToKitchen', 'takeaway');
      expect(kitchenDetails.currentStepIndex).toBe(1);
      expect(kitchenDetails.label).toBe('Accepted');

      const prepDetails = getCustomerStatusDetails('preparing', 'takeaway');
      expect(prepDetails.currentStepIndex).toBe(2);
      expect(prepDetails.label).toBe('Preparing');

      const readyDetails = getCustomerStatusDetails('ready', 'takeaway');
      expect(readyDetails.currentStepIndex).toBe(3);
      expect(readyDetails.label).toBe('Ready for Pickup');

      const completedDetails = getCustomerStatusDetails('completed', 'takeaway');
      expect(completedDetails.currentStepIndex).toBe(4);
      expect(completedDetails.label).toBe('Picked Up');
      expect(completedDetails.isTerminal).toBe(true);
    });

    it('correctly maps delivery order lifecycle without fabricating unbacked states', () => {
      const readyDelivery = getCustomerStatusDetails('ready', 'delivery');
      expect(readyDelivery.currentStepIndex).toBe(3);
      expect(readyDelivery.label).toBe('Food Ready & Packed');

      const delivered = getCustomerStatusDetails('completed', 'delivery');
      expect(delivered.currentStepIndex).toBe(4);
      expect(delivered.label).toBe('Delivered');
      expect(delivered.isTerminal).toBe(true);
    });

    it('correctly handles cancelled orders and indicates cancellation', () => {
      const cancelled = getCustomerStatusDetails('cancelled', 'takeaway');
      expect(cancelled.isCancelled).toBe(true);
      expect(cancelled.isTerminal).toBe(true);
      expect(cancelled.label).toBe('Order Cancelled');
      expect(cancelled.currentStepIndex).toBe(-1);
    });
  });

  describe('E & F. Real-time Subscription & LocalStorage Reference Management', () => {
    it('subscribes to order updates and handles snapshot cleanly', () => {
      const mockUnsub = vi.fn();
      vi.mocked(firestore.onSnapshot).mockImplementationOnce((_ref, onNext: any) => {
        onNext({
          exists: () => true,
          id: 'ORD_AUTH_001',
          data: () => sampleAuthOrder
        });
        return mockUnsub;
      });

      const onUpdate = vi.fn();
      const onError = vi.fn();

      const unsub = subscribeToOrderTracking(
        'REST_ABC',
        'ORD_AUTH_001',
        onUpdate,
        onError,
        'CUST_AUTH_123'
      );

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ORD_AUTH_001',
          status: 'preparing'
        })
      );
      expect(onError).not.toHaveBeenCalled();

      // Verify unmount cleanup
      unsub();
      expect(mockUnsub).toHaveBeenCalled();
    });

    it('saves and retrieves tracked order references in localStorage for authenticated user', () => {
      saveTrackedOrder({
        orderId: 'ORD_AUTH_001',
        restaurantId: 'REST_ABC',
        orderNumber: 'ORD-101',
        orderType: 'takeaway',
        status: 'preparing',
        grandTotalMinor: 52500,
        itemCount: 2,
        placedAt: new Date().toISOString(),
        customerId: 'CUST_AUTH_123'
      });

      const tracked = getTrackedOrders('CUST_AUTH_123');
      expect(tracked.length).toBe(1);
      expect(tracked[0].orderId).toBe('ORD_AUTH_001');

      const activeCount = getActiveOrdersCount('CUST_AUTH_123');
      expect(activeCount).toBe(1);
    });

    it('isolates guest and authenticated localStorage references', () => {
      saveTrackedOrder({
        orderId: 'ORD_GUEST_002',
        restaurantId: 'REST_ABC',
        orderNumber: 'ORD-102',
        orderType: 'delivery',
        status: 'confirmed',
        grandTotalMinor: 21000,
        itemCount: 1,
        placedAt: new Date().toISOString(),
        customerId: null
      });

      const guestOrders = getTrackedOrders(null);
      expect(guestOrders.length).toBe(1);
      expect(guestOrders[0].orderId).toBe('ORD_GUEST_002');

      const authOrders = getTrackedOrders('CUST_AUTH_123');
      expect(authOrders.length).toBe(0);
    });
  });

  describe('G & H. UI Component Rendering & Interactivity', () => {
    it('renders OrderStatusTimeline with active and completed steps', () => {
      render(
        <OrderStatusTimeline
          status="preparing"
          orderType="takeaway"
          placedAt="2026-09-16T02:00:00.000Z"
        />
      );

      expect(screen.getByText('Current Status')).toBeInTheDocument();
      expect(screen.getAllByText('Preparing').length).toBeGreaterThan(0);
      expect(screen.getByText('Ready for Pickup')).toBeInTheDocument();
    });

    it('renders CustomerOrderTrackingModal with order details and live indicator', async () => {
      vi.mocked(firestore.onSnapshot).mockImplementationOnce((_ref, onNext: any) => {
        onNext({
          exists: () => true,
          id: 'ORD_AUTH_001',
          data: () => sampleAuthOrder
        });
        return vi.fn();
      });

      vi.mocked(firestore.getDoc).mockResolvedValueOnce({
        exists: () => true,
        id: 'ORD_AUTH_001',
        data: () => sampleAuthOrder
      } as any);

      render(
        <CustomerOrderTrackingModal
          isOpen={true}
          onClose={vi.fn()}
          restaurantId="REST_ABC"
          orderId="ORD_AUTH_001"
          initialOrder={sampleAuthOrder}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/ORD-101/)).toBeInTheDocument();
      });
      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.getByText('Paneer Butter Masala')).toBeInTheDocument();
      expect(screen.getAllByText('₹525.00').length).toBeGreaterThan(0);
    });

    it('renders CustomerMyOrdersModal with active and past tabs', async () => {
      saveTrackedOrder({
        orderId: 'ORD_AUTH_001',
        restaurantId: 'REST_ABC',
        orderNumber: 'ORD-101',
        orderType: 'takeaway',
        status: 'preparing',
        grandTotalMinor: 52500,
        itemCount: 2,
        placedAt: new Date().toISOString(),
        customerId: 'CUST_AUTH_123'
      });

      vi.mocked(firestore.getDoc).mockResolvedValueOnce({
        exists: () => true,
        id: 'ORD_AUTH_001',
        data: () => sampleAuthOrder
      } as any);

      render(
        <CustomerMyOrdersModal
          isOpen={true}
          onClose={vi.fn()}
          onSelectOrderToTrack={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('My Orders')).toBeInTheDocument();
        expect(screen.getByText(/Active Orders/i)).toBeInTheDocument();
        expect(screen.getByText(/ORD-101/)).toBeInTheDocument();
        expect(screen.getByText('Track Order')).toBeInTheDocument();
      });
    });
  });
});
