import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  subscribeToNewOnlineOrders,
  resetSeenOrderCache
} from '../services/onlineOrderNotificationService';
import {
  playNewOrderSoundAlert,
  isSoundAlertEnabled,
  setSoundAlertEnabled,
  resetAudioContextForTesting
} from '../utils/soundAlert';
import { NewOnlineOrderNotification } from '../components/notifications/NewOnlineOrderNotification';
import { Order } from '../types/order';

// Mock dependencies
const mockOnSnapshotListeners: Array<{
  q: any;
  onNext: (snapshot: any) => void;
  onError?: (err: any) => void;
}> = [];

vi.mock('../config/firebase', () => ({
  auth: {
    currentUser: { uid: 'staff_1', email: 'staff@example.com' }
  },
  db: {}
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  query: vi.fn((colRef, ...constraints) => ({ colRef, constraints })),
  where: vi.fn((field, op, val) => ({ field, op, val })),
  orderBy: vi.fn((field, dir) => ({ field, dir })),
  onSnapshot: vi.fn((q, onNext, onError) => {
    mockOnSnapshotListeners.push({ q, onNext, onError });
    return () => {
      const idx = mockOnSnapshotListeners.findIndex((l) => l.q === q);
      if (idx !== -1) mockOnSnapshotListeners.splice(idx, 1);
    };
  })
}));

describe('Milestone 9 — Phase 3: Restaurant New Online Order Notification', () => {
  beforeEach(() => {
    mockOnSnapshotListeners.length = 0;
    resetSeenOrderCache();
    resetAudioContextForTesting();
    setSoundAlertEnabled(true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetSeenOrderCache();
    resetAudioContextForTesting();
  });

  const createMockOrder = (
    id: string,
    orderNumber: string,
    source: any = 'online',
    orderType: any = 'takeaway',
    status: any = 'sentToKitchen'
  ): Order => ({
    id,
    restaurantId: 'rest_alpha',
    orderNumber,
    source,
    orderType,
    status,
    grandTotalMinor: 45000,
    subtotalMinor: 40000,
    discountMinor: 0,
    cgstMinor: 2500,
    sgstMinor: 2500,
    igstMinor: 0,
    paidAmountMinor: 0,
    dueAmountMinor: 45000,
    items: [
      {
        itemId: 'item_1',
        nameSnapshot: 'Paneer Butter Masala',
        shortNameSnapshot: 'Paneer Masala',
        quantity: 1,
        unitPriceMinor: 40000,
        taxRate: 5,
        taxInclusive: false,
        discountMinor: 0,
        lineSubtotalMinor: 40000,
        lineTaxMinor: 2000,
        lineTotalMinor: 42000
      }
    ],
    customerSnapshot: {
      name: 'Priya Sharma',
      phone: '+919876543210'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'online_checkout'
  });

  // 1. Online order creation triggers notification listener callback
  it('1. triggers onNewOrder callback when a new online order arrives after initial load', () => {
    const receivedOrders: Order[] = [];
    const unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (order) => receivedOrders.push(order)
    });

    expect(mockOnSnapshotListeners.length).toBe(1);
    const listener = mockOnSnapshotListeners[0];

    // Initial snapshot with 0 orders
    listener.onNext({
      docs: [],
      docChanges: () => []
    });

    expect(receivedOrders.length).toBe(0);

    // Incoming new online order
    const newOrder = createMockOrder('ord_101', 'ORD-101');
    listener.onNext({
      docs: [{ id: newOrder.id, data: () => newOrder }],
      docChanges: () => [
        {
          type: 'added',
          doc: { id: newOrder.id, data: () => newOrder }
        }
      ]
    });

    expect(receivedOrders.length).toBe(1);
    expect(receivedOrders[0].id).toBe('ord_101');
    expect(receivedOrders[0].orderNumber).toBe('ORD-101');
    expect(receivedOrders[0].customerSnapshot?.name).toBe('Priya Sharma');

    unsubscribe();
  });

  // 2. Initial page load with existing online orders does NOT trigger notifications
  it('2. suppresses notifications for historical orders present during initial page load', () => {
    const receivedOrders: Order[] = [];
    const historicalOrder1 = createMockOrder('hist_1', 'ORD-001');
    const historicalOrder2 = createMockOrder('hist_2', 'ORD-002');

    const unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (order) => receivedOrders.push(order)
    });

    const listener = mockOnSnapshotListeners[0];

    // Initial snapshot contains 2 historical orders
    listener.onNext({
      docs: [
        { id: historicalOrder1.id, data: () => historicalOrder1 },
        { id: historicalOrder2.id, data: () => historicalOrder2 }
      ],
      docChanges: () => [
        { type: 'added', doc: { id: historicalOrder1.id, data: () => historicalOrder1 } },
        { type: 'added', doc: { id: historicalOrder2.id, data: () => historicalOrder2 } }
      ]
    });

    // Both historical orders MUST be suppressed
    expect(receivedOrders.length).toBe(0);

    // Only subsequent new order should trigger
    const newOrder = createMockOrder('new_1', 'ORD-003');
    listener.onNext({
      docs: [
        { id: historicalOrder1.id, data: () => historicalOrder1 },
        { id: historicalOrder2.id, data: () => historicalOrder2 },
        { id: newOrder.id, data: () => newOrder }
      ],
      docChanges: () => [
        { type: 'added', doc: { id: newOrder.id, data: () => newOrder } }
      ]
    });

    expect(receivedOrders.length).toBe(1);
    expect(receivedOrders[0].id).toBe('new_1');

    unsubscribe();
  });

  // 3. Repeated snapshots of the same order do NOT trigger duplicate notifications
  it('3. prevents duplicate notifications across repeated snapshots for the same order', () => {
    const receivedOrders: Order[] = [];
    const unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (order) => receivedOrders.push(order)
    });

    const listener = mockOnSnapshotListeners[0];
    listener.onNext({ docs: [], docChanges: () => [] }); // initial empty

    const order = createMockOrder('ord_dup_1', 'ORD-DUP-1');

    // First arrival
    listener.onNext({
      docs: [{ id: order.id, data: () => order }],
      docChanges: () => [{ type: 'added', doc: { id: order.id, data: () => order } }]
    });
    expect(receivedOrders.length).toBe(1);

    // Repeated snapshot with the same order
    listener.onNext({
      docs: [{ id: order.id, data: () => order }],
      docChanges: () => [{ type: 'added', doc: { id: order.id, data: () => order } }]
    });
    expect(receivedOrders.length).toBe(1); // STILL 1, no duplicate!

    unsubscribe();
  });

  // 4. Firestore reconnect / offline-to-online recovery does NOT re-trigger notifications
  it('4. retains known order cache on Firestore reconnect and does not re-alert existing orders', () => {
    const receivedOrders: Order[] = [];
    let unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (order) => receivedOrders.push(order)
    });

    let listener = mockOnSnapshotListeners[0];
    listener.onNext({ docs: [], docChanges: () => [] }); // initial

    const order = createMockOrder('ord_recon_1', 'ORD-RECON-1');
    listener.onNext({
      docs: [{ id: order.id, data: () => order }],
      docChanges: () => [{ type: 'added', doc: { id: order.id, data: () => order } }]
    });
    expect(receivedOrders.length).toBe(1);

    // Simulate network disconnect: listener unmounts/resubscribes
    unsubscribe();

    // Reconnect: re-subscribe to the same restaurant
    unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (order) => receivedOrders.push(order)
    });
    listener = mockOnSnapshotListeners[mockOnSnapshotListeners.length - 1];

    // Reconnected initial snapshot delivers the existing order again
    listener.onNext({
      docs: [{ id: order.id, data: () => order }],
      docChanges: () => [{ type: 'added', doc: { id: order.id, data: () => order } }]
    });

    // Still exactly 1 notification, zero duplicates across reconnect!
    expect(receivedOrders.length).toBe(1);

    unsubscribe();
  });

  // 5. Non-online orders (POS dine-in, captain, admin) do NOT trigger online order notification
  it('5. ignores non-online orders (pos, captain, admin)', () => {
    const receivedOrders: Order[] = [];
    const unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (order) => receivedOrders.push(order)
    });

    const listener = mockOnSnapshotListeners[0];
    listener.onNext({ docs: [], docChanges: () => [] }); // initial

    const posDineIn = createMockOrder('ord_pos_1', 'ORD-POS-1', 'pos', 'dineIn');
    const captainOrder = createMockOrder('ord_cap_1', 'ORD-CAP-1', 'captain', 'dineIn');

    listener.onNext({
      docs: [
        { id: posDineIn.id, data: () => posDineIn },
        { id: captainOrder.id, data: () => captainOrder }
      ],
      docChanges: () => [
        { type: 'added', doc: { id: posDineIn.id, data: () => posDineIn } },
        { type: 'added', doc: { id: captainOrder.id, data: () => captainOrder } }
      ]
    });

    expect(receivedOrders.length).toBe(0);

    unsubscribe();
  });

  // 6. Multiple different new online orders (ORD-1, ORD-2, ORD-3) each trigger distinct notifications
  it('6. detects and notifies each distinct new online order when multiple arrive close together', () => {
    const receivedOrders: Order[] = [];
    const unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (order) => receivedOrders.push(order)
    });

    const listener = mockOnSnapshotListeners[0];
    listener.onNext({ docs: [], docChanges: () => [] }); // initial

    const o1 = createMockOrder('ord_1', 'ORD-101');
    const o2 = createMockOrder('ord_2', 'ORD-102');
    const o3 = createMockOrder('ord_3', 'ORD-103');

    listener.onNext({
      docs: [
        { id: o1.id, data: () => o1 },
        { id: o2.id, data: () => o2 },
        { id: o3.id, data: () => o3 }
      ],
      docChanges: () => [
        { type: 'added', doc: { id: o1.id, data: () => o1 } },
        { type: 'added', doc: { id: o2.id, data: () => o2 } },
        { type: 'added', doc: { id: o3.id, data: () => o3 } }
      ]
    });

    expect(receivedOrders.length).toBe(3);
    expect(receivedOrders.map((o) => o.orderNumber)).toEqual(['ORD-101', 'ORD-102', 'ORD-103']);

    unsubscribe();
  });

  // 7. Sound alert is triggered when sound is enabled
  it('7. attempts sound alert synthesis when sound is enabled', async () => {
    // Mock AudioContext
    const mockOscillator = {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    };
    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    };
    const mockAudioCtx = {
      state: 'running',
      currentTime: 10,
      createOscillator: vi.fn(() => mockOscillator),
      createGain: vi.fn(() => mockGain),
      destination: {}
    };

    class MockAudioContext {
      state = mockAudioCtx.state;
      currentTime = mockAudioCtx.currentTime;
      destination = mockAudioCtx.destination;
      createOscillator = mockAudioCtx.createOscillator;
      createGain = mockAudioCtx.createGain;
    }

    (window as any).AudioContext = MockAudioContext;

    setSoundAlertEnabled(true);
    const played = await playNewOrderSoundAlert();

    expect(played).toBe(true);
    expect(mockAudioCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  // 8. Audio autoplay failure / Promise rejection is handled gracefully
  it('8. handles browser autoplay restriction or AudioContext suspension gracefully without crashing', async () => {
    class MockSuspendedAudioCtx {
      state = 'suspended';
      destination = {};
      resume = vi.fn().mockRejectedValue(new Error('Autoplay blocked by browser'));
    }

    (window as any).AudioContext = MockSuspendedAudioCtx;

    setSoundAlertEnabled(true);
    // MUST NOT THROW
    const played = await playNewOrderSoundAlert();
    expect(played).toBe(false);
  });

  // 9. Dismissing the visual notification clears it from the UI
  it('9. dismissing an individual card removes it from the UI', () => {
    const o1 = createMockOrder('ord_1', 'ORD-101');
    const onDismiss = vi.fn();
    const onDismissAll = vi.fn();
    const onViewOrder = vi.fn();

    const { rerender } = render(
      <NewOnlineOrderNotification
        orders={[o1]}
        onDismiss={onDismiss}
        onDismissAll={onDismissAll}
        onViewOrder={onViewOrder}
      />
    );

    expect(screen.getByText('ORD-101')).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();

    const dismissBtn = screen.getByTitle('Dismiss notification');
    fireEvent.click(dismissBtn);

    expect(onDismiss).toHaveBeenCalledWith('ord_1');

    // Re-render with cleared list
    rerender(
      <NewOnlineOrderNotification
        orders={[]}
        onDismiss={onDismiss}
        onDismissAll={onDismissAll}
        onViewOrder={onViewOrder}
      />
    );

    expect(screen.queryByText('ORD-101')).not.toBeInTheDocument();
  });

  // 10. Dismissing the notification does NOT change order status in Firestore
  it('10. verifies that dismissing a notification is purely local and does not mutate order status', () => {
    const order = createMockOrder('ord_safe', 'ORD-SAFE-1');
    const initialStatus = order.status;

    const onDismiss = (orderId: string) => {
      // Local dismissal handler verifies order object remains unaltered
      expect(orderId).toBe('ord_safe');
      expect(order.status).toBe(initialStatus);
    };

    render(
      <NewOnlineOrderNotification
        orders={[order]}
        onDismiss={onDismiss}
        onDismissAll={() => {}}
        onViewOrder={() => {}}
      />
    );

    const dismissBtn = screen.getByTitle('Dismiss notification');
    fireEvent.click(dismissBtn);

    expect(order.status).toBe('sentToKitchen'); // UNCHANGED
  });

  // 11. View Order action triggers navigation
  it('11. clicking VIEW ORDER triggers onViewOrder callback with order payload', () => {
    const order = createMockOrder('ord_nav', 'ORD-NAV-1');
    const onViewOrder = vi.fn();

    render(
      <NewOnlineOrderNotification
        orders={[order]}
        onDismiss={() => {}}
        onDismissAll={() => {}}
        onViewOrder={onViewOrder}
      />
    );

    const viewBtn = screen.getByRole('button', { name: /VIEW ORDER/i });
    fireEvent.click(viewBtn);

    expect(onViewOrder).toHaveBeenCalledTimes(1);
    expect(onViewOrder).toHaveBeenCalledWith(order);
  });

  // 12. Multi-tenant isolation
  it('12. enforces multi-tenant isolation: orders for restaurant_B never trigger notifications for restaurant_A', () => {
    const receivedA: Order[] = [];
    const receivedB: Order[] = [];

    const unsubscribeA = subscribeToNewOnlineOrders('restaurant_A', {
      onNewOrder: (ord) => receivedA.push(ord)
    });
    const unsubscribeB = subscribeToNewOnlineOrders('restaurant_B', {
      onNewOrder: (ord) => receivedB.push(ord)
    });

    const listenerA = mockOnSnapshotListeners[0];
    const listenerB = mockOnSnapshotListeners[1];

    listenerA.onNext({ docs: [], docChanges: () => [] });
    listenerB.onNext({ docs: [], docChanges: () => [] });

    // Order created exclusively in restaurant_B
    const orderB = {
      ...createMockOrder('ord_b_1', 'ORD-B1'),
      restaurantId: 'restaurant_B'
    };

    listenerB.onNext({
      docs: [{ id: orderB.id, data: () => orderB }],
      docChanges: () => [{ type: 'added', doc: { id: orderB.id, data: () => orderB } }]
    });

    expect(receivedB.length).toBe(1);
    expect(receivedA.length).toBe(0); // Tenant A received NOTHING

    unsubscribeA();
    unsubscribeB();
  });

  // 13. Muting sound suppresses audio playback while visual notification continues to work
  it('13. muting sound suppresses audio playback while visual notifications remain functional', async () => {
    setSoundAlertEnabled(false);
    expect(isSoundAlertEnabled()).toBe(false);

    const played = await playNewOrderSoundAlert();
    expect(played).toBe(false);

    // Visual notification still renders perfectly
    const order = createMockOrder('ord_mute', 'ORD-MUTE-1');
    render(
      <NewOnlineOrderNotification
        orders={[order]}
        onDismiss={() => {}}
        onDismissAll={() => {}}
        onViewOrder={() => {}}
        isSoundEnabled={false}
      />
    );

    expect(screen.getByText('ORD-MUTE-1')).toBeInTheDocument();
  });

  // 14. Rapid burst of new online orders is cleanly handled without dropping orders
  it('14. handles a burst of 10 incoming online orders without dropping notifications', () => {
    const receivedOrders: Order[] = [];
    const unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (ord) => receivedOrders.push(ord)
    });

    const listener = mockOnSnapshotListeners[0];
    listener.onNext({ docs: [], docChanges: () => [] }); // initial

    const burstOrders = Array.from({ length: 10 }, (_, i) =>
      createMockOrder(`burst_${i}`, `ORD-BURST-${i}`)
    );

    listener.onNext({
      docs: burstOrders.map((o) => ({ id: o.id, data: () => o })),
      docChanges: () =>
        burstOrders.map((o) => ({
          type: 'added',
          doc: { id: o.id, data: () => o }
        }))
    });

    expect(receivedOrders.length).toBe(10);
    expect(new Set(receivedOrders.map((o) => o.id)).size).toBe(10);

    unsubscribe();
  });

  // 15. Order cancellation / updates to existing orders do NOT trigger new order notifications
  it('15. ignores status updates and cancellations on existing orders', () => {
    const receivedOrders: Order[] = [];
    const unsubscribe = subscribeToNewOnlineOrders('rest_alpha', {
      onNewOrder: (ord) => receivedOrders.push(ord)
    });

    const listener = mockOnSnapshotListeners[0];
    const initialOrder = createMockOrder('ord_update_test', 'ORD-UPD-1', 'online', 'takeaway', 'sentToKitchen');

    // Initial snapshot contains initialOrder
    listener.onNext({
      docs: [{ id: initialOrder.id, data: () => initialOrder }],
      docChanges: () => [{ type: 'added', doc: { id: initialOrder.id, data: () => initialOrder } }]
    });

    // Initial order suppressed
    expect(receivedOrders.length).toBe(0);

    // Status updated to 'cancelled'
    const cancelledOrder = { ...initialOrder, status: 'cancelled' as const };
    listener.onNext({
      docs: [{ id: cancelledOrder.id, data: () => cancelledOrder }],
      docChanges: () => [{ type: 'modified', doc: { id: cancelledOrder.id, data: () => cancelledOrder } }]
    });

    // Modified event MUST NOT trigger new order notification
    expect(receivedOrders.length).toBe(0);

    unsubscribe();
  });
});
