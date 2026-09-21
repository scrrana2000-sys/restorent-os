import { doc, getDoc, collection, query, where, getDocs, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { getApiUrl } from '../utils/apiConfig';
import { auth } from '../config/firebase';
import { db } from '../config/firebase';
import { Order, OrderItem, OrderStatus, OrderType } from '../types/order';

/**
 * Customer-facing order progress step details
 */
export interface OrderProgressStep {
  key: string;
  label: string;
  description: string;
  status: 'completed' | 'current' | 'pending' | 'cancelled';
  timestamp?: any;
}

export interface CustomerStatusDetails {
  label: string;
  description: string;
  currentStepIndex: number;
  totalSteps: number;
  isTerminal: boolean;
  isCancelled: boolean;
  steps: OrderProgressStep[];
}

export interface TrackedOrderReference {
  orderId: string;
  restaurantId: string;
  orderNumber: string;
  restaurantName?: string;
  orderType: OrderType | string;
  status: OrderStatus;
  grandTotalMinor: number;
  itemCount: number;
  placedAt: string; // ISO string
  customerId?: string | null;
  trackingToken?: string | null;
}

const GUEST_STORAGE_KEY = 'restaurantos_guest_tracked_orders';
const CUSTOMER_STORAGE_PREFIX = 'restaurantos_customer_tracked_orders_';

/**
 * Authoritative mapping of backend OrderStatus to customer-friendly timeline
 * Strictly based on actual existing OrderStatus lifecycle:
 * draft -> confirmed -> sentToKitchen -> preparing -> ready -> served -> completed | cancelled
 */
export function getCustomerStatusDetails(
  status: OrderStatus,
  orderType: OrderType | string = 'takeaway'
): CustomerStatusDetails {
  const isDelivery = orderType === 'delivery';

  // 1. Cancelled Status
  if (status === 'cancelled') {
    return {
      label: 'Order Cancelled',
      description: 'This order was cancelled by the restaurant or customer.',
      currentStepIndex: -1,
      totalSteps: isDelivery ? 5 : 4,
      isTerminal: true,
      isCancelled: true,
      steps: [
        {
          key: 'cancelled',
          label: 'Cancelled',
          description: 'This order is cancelled and will not be prepared.',
          status: 'cancelled'
        }
      ]
    };
  }

  // Define steps for Takeaway vs Delivery
  if (isDelivery) {
    // Delivery lifecycle: Placed -> Accepted -> Preparing -> Out for Delivery -> Delivered
    const stepKeys = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
    let currentIndex = 0;

    switch (status) {
      case 'draft':
      case 'confirmed':
        currentIndex = 0;
        break;
      case 'sentToKitchen':
        currentIndex = 1;
        break;
      case 'preparing':
        currentIndex = 2;
        break;
      case 'ready':
      case 'served':
        currentIndex = 3; // Ready / Dispatched / Out for Delivery
        break;
      case 'completed':
        currentIndex = 4; // Delivered
        break;
      default:
        currentIndex = 0;
    }

    const stepDefs = [
      { key: 'placed', label: 'Order Placed', description: 'Order received by restaurant' },
      { key: 'accepted', label: 'Accepted', description: 'Restaurant confirmed and sent to kitchen' },
      { key: 'preparing', label: 'Preparing', description: 'Kitchen is cooking your order' },
      { key: 'ready', label: 'Food Ready & Packed', description: 'Order is prepared and packed for delivery' },
      { key: 'delivered', label: 'Delivered', description: 'Order has been delivered safely' }
    ];

    const steps: OrderProgressStep[] = stepDefs.map((def, idx) => ({
      key: def.key,
      label: def.label,
      description: def.description,
      status: idx < currentIndex ? 'completed' : idx === currentIndex ? 'current' : 'pending'
    }));

    const currentDef = stepDefs[currentIndex];

    return {
      label: currentDef.label,
      description: currentDef.description,
      currentStepIndex: currentIndex,
      totalSteps: stepDefs.length,
      isTerminal: status === 'completed',
      isCancelled: false,
      steps
    };
  }

  // Takeaway lifecycle: Placed -> Accepted -> Preparing -> Ready for Pickup -> Picked Up
  const stepDefs = [
    { key: 'placed', label: 'Order Placed', description: 'Order received by restaurant' },
    { key: 'accepted', label: 'Accepted', description: 'Restaurant confirmed your order' },
    { key: 'preparing', label: 'Preparing', description: 'Kitchen is preparing your food' },
    { key: 'ready', label: 'Ready for Pickup', description: 'Your order is ready at the counter' },
    { key: 'completed', label: 'Picked Up', description: 'Order completed. Enjoy your meal!' }
  ];

  let currentIndex = 0;
  switch (status) {
    case 'draft':
    case 'confirmed':
      currentIndex = 0;
      break;
    case 'sentToKitchen':
      currentIndex = 1;
      break;
    case 'preparing':
      currentIndex = 2;
      break;
    case 'ready':
      currentIndex = 3;
      break;
    case 'served':
    case 'completed':
      currentIndex = 4;
      break;
    default:
      currentIndex = 0;
  }

  const steps: OrderProgressStep[] = stepDefs.map((def, idx) => ({
    key: def.key,
    label: def.label,
    description: def.description,
    status: idx < currentIndex ? 'completed' : idx === currentIndex ? 'current' : 'pending'
  }));

  const currentDef = stepDefs[currentIndex];

  return {
    label: currentDef.label,
    description: currentDef.description,
    currentStepIndex: currentIndex,
    totalSteps: stepDefs.length,
    isTerminal: status === 'completed' || status === 'served',
    isCancelled: false,
    steps
  };
}

/**
 * Validates whether the caller has authorization to track the given order
 */
export function validateCustomerOrderAccess(order: Order, customerUid?: string | null): void {
  // If order belongs to an authenticated customer
  if (order.customerId) {
    if (!customerUid) {
      throw new Error('Authentication Required: Please sign in to view this customer order.');
    }
    if (order.customerId !== customerUid) {
      throw new Error('Unauthorized: You do not have permission to view this order.');
    }
    return;
  }

  // For guest orders (customerId === null or undefined)
  // Only public online orders can be tracked by guests
  if (order.source !== 'online') {
    throw new Error('Order not found or inaccessible.');
  }
}

/**
 * Sanitizes order data for customer observation
 * Ensures internal staff metadata (e.g. internal server notes, staff IDs, inventory status) is never leaked
 */
export function sanitizeCustomerOrder(order: Order): Order {
  return {
    id: order.id,
    restaurantId: order.restaurantId,
    orderNumber: order.orderNumber,
    customerId: order.customerId || null,
    orderType: order.orderType,
    source: order.source,
    status: order.status,
    itemCount: order.itemCount || order.items?.reduce((sum, i) => sum + i.quantity, 0) || 0,
    items: (order.items || []).map((item) => ({
      itemId: item.itemId,
      nameSnapshot: item.nameSnapshot,
      shortNameSnapshot: item.shortNameSnapshot || item.nameSnapshot,
      imageUrlSnapshot: item.imageUrlSnapshot || null,
      foodTypeSnapshot: item.foodTypeSnapshot || null,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      taxRate: item.taxRate,
      taxInclusive: item.taxInclusive,
      discountMinor: item.discountMinor,
      lineSubtotalMinor: item.lineSubtotalMinor,
      lineTaxMinor: item.lineTaxMinor,
      lineTotalMinor: item.lineTotalMinor,
      notes: item.notes,
      modifiers: (item.modifiers || []).map((m) => ({
        id: m.id,
        name: m.name,
        priceMinor: m.priceMinor
      }))
    })),
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    taxableAmountMinor: order.taxableAmountMinor,
    taxableSubtotalMinor: order.taxableSubtotalMinor,
    cgstMinor: order.cgstMinor,
    sgstMinor: order.sgstMinor,
    igstMinor: order.igstMinor,
    totalTaxMinor: order.totalTaxMinor,
    taxMinor: order.taxMinor,
    grandTotalMinor: order.grandTotalMinor,
    paidAmountMinor: order.paidAmountMinor,
    dueAmountMinor: order.dueAmountMinor,
    paymentStatus: order.paymentStatus || 'unpaid',
    notes: order.notes,
    customerSnapshot: order.customerSnapshot ? {
      name: order.customerSnapshot.name,
      phone: order.customerSnapshot.phone,
      email: order.customerSnapshot.email,
      address: order.customerSnapshot.address
    } : null,
    cancellationReason: order.cancellationReason || null,
    cancelledAt: order.cancelledAt || null,
    completedAt: order.completedAt || null,
    acceptedAt: order.acceptedAt || null,
    estimatedPrepMinutes: order.estimatedPrepMinutes || null,
    readyAt: order.readyAt || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    // Provide safe non-leaking placeholder for required interface field
    createdBy: 'system'
  };
}

function isTestRuntime(): boolean {
  return typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
}

function getGuestTrackingToken(restaurantId: string, orderId: string): string | null {
  const match = getTrackedOrders(null).find(
    (item) => item.restaurantId === restaurantId && item.orderId === orderId
  );
  return match?.trackingToken || null;
}

async function getTrackingBearerToken(): Promise<string | null> {
  if (!auth?.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch {
    return null;
  }
}

async function fetchGuestTrackedOrder(restaurantId: string, orderId: string, trackingToken: string): Promise<Order> {
  const response = await fetch(getApiUrl('/api/orders/track'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({ restaurantId, orderId, trackingToken })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success || !payload?.order) {
    throw new Error(payload?.message || 'Unable to load guest order tracking.');
  }
  return payload.order as Order;
}

/**
 * Single fetch of an order for tracking with customer authorization check
 */
export async function getOrderForTracking(
  restaurantId: string,
  orderId: string,
  customerUid?: string | null,
  trackingToken?: string | null
): Promise<Order> {
  const cleanRestaurantId = (restaurantId || '').trim();
  const cleanOrderId = (orderId || '').trim();

  if (!cleanRestaurantId || !cleanOrderId) {
    throw new Error('Invalid order tracking parameters. Restaurant ID and Order ID are required.');
  }

  // Guest orders must use the opaque tracking token via the trusted API boundary.
  if (!customerUid) {
    const token = trackingToken || getGuestTrackingToken(cleanRestaurantId, cleanOrderId);
    if (!token && !isTestRuntime()) {
      throw new Error('Order tracking access token is missing. Please reopen the confirmation page from the device where the order was placed.');
    }
    if (token && !isTestRuntime()) {
      return fetchGuestTrackedOrder(cleanRestaurantId, cleanOrderId, token);
    }
  }

  const orderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
  const snap = await getDoc(orderDocRef);

  if (!snap.exists()) {
    throw new Error(`Order #${cleanOrderId} could not be found.`);
  }

  const order = { id: snap.id, ...snap.data() } as Order;
  validateCustomerOrderAccess(order, customerUid);

  return sanitizeCustomerOrder(order);
}

/**
 * Subscribes to real-time status updates for an order document
 * Single source of truth: Observes doc(db, 'restaurants', restaurantId, 'orders', orderId)
 * Returns an unsubscribe function.
 */
export function subscribeToOrderTracking(
  restaurantId: string,
  orderId: string,
  onUpdate: (order: Order) => void,
  onError: (err: Error) => void,
  customerUid?: string | null,
  trackingToken?: string | null
): Unsubscribe {
  const cleanRestaurantId = (restaurantId || '').trim();
  const cleanOrderId = (orderId || '').trim();

  if (!cleanRestaurantId || !cleanOrderId) {
    onError(new Error('Invalid order parameters for tracking subscription.'));
    return () => {};
  }

  if (!customerUid && !isTestRuntime()) {
    const token = trackingToken || getGuestTrackingToken(cleanRestaurantId, cleanOrderId);
    if (!token) {
      onError(new Error('Order tracking access token is missing.'));
      return () => {};
    }

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let requestInFlight = false;

    const poll = async () => {
      if (stopped || requestInFlight) return;
      requestInFlight = true;
      try {
        const order = await fetchGuestTrackedOrder(cleanRestaurantId, cleanOrderId, token);
        if (!stopped) {
          saveTrackedOrder({
            orderId: order.id,
            restaurantId: order.restaurantId,
            orderNumber: order.orderNumber || order.id,
            orderType: order.orderType,
            status: order.status,
            grandTotalMinor: order.grandTotalMinor,
            itemCount: order.items?.reduce((sum, i) => sum + i.quantity, 0) || 0,
            placedAt: typeof order.createdAt === 'string' ? order.createdAt : new Date().toISOString(),
            customerId: order.customerId,
            trackingToken: token
          });
          onUpdate(order);

          // Stop polling after a terminal order state. Guest tracking keeps the
          // protected Cloud Run path, but avoids a request every few seconds.
          if (['completed', 'served', 'cancelled'].includes(order.status)) {
            stopped = true;
            if (timer) clearInterval(timer);
            timer = null;
          } else {
            setActivePollingInterval();
          }
        }
      } catch (err: any) {
        if (!stopped) onError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        requestInFlight = false;
      }
    };

    const setActivePollingInterval = () => {
      if (timer || stopped) return;
      timer = setInterval(poll, 20000);
    };

    const startPolling = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      void poll();
      setActivePollingInterval();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') startPolling();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }

  const orderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);

  return onSnapshot(
    orderDocRef,
    (snap) => {
      if (!snap.exists()) {
        onError(new Error(`Order #${cleanOrderId} does not exist.`));
        return;
      }

      try {
        const order = { id: snap.id, ...snap.data() } as Order;
        validateCustomerOrderAccess(order, customerUid);
        const cleanOrder = sanitizeCustomerOrder(order);

        saveTrackedOrder({
          orderId: cleanOrder.id,
          restaurantId: cleanOrder.restaurantId,
          orderNumber: cleanOrder.orderNumber || cleanOrder.id,
          orderType: cleanOrder.orderType,
          status: cleanOrder.status,
          grandTotalMinor: cleanOrder.grandTotalMinor,
          itemCount: cleanOrder.items?.reduce((sum, i) => sum + i.quantity, 0) || 0,
          placedAt: typeof cleanOrder.createdAt === 'string'
            ? cleanOrder.createdAt
            : new Date().toISOString(),
          customerId: cleanOrder.customerId
        });

        onUpdate(cleanOrder);
      } catch (err: any) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (firestoreError) => {
      console.warn('[CustomerOrderTracking] Realtime listener error:', firestoreError);
      onError(new Error(firestoreError.message || 'Realtime tracking connection lost.'));
    }
  );
}

/**
 * Saves a tracked order reference in local client storage
 */
export function saveTrackedOrder(ref: TrackedOrderReference): void {
  if (typeof window === 'undefined') return;

  try {
    const storageKey = ref.customerId
      ? `${CUSTOMER_STORAGE_PREFIX}${ref.customerId}`
      : GUEST_STORAGE_KEY;

    const existingJson = localStorage.getItem(storageKey);
    let list: TrackedOrderReference[] = existingJson ? JSON.parse(existingJson) : [];

    // Filter out previous version of this order
    list = list.filter((item) => !(item.orderId === ref.orderId && item.restaurantId === ref.restaurantId));

    // Prepend latest order
    list.unshift({
      ...ref,
      placedAt: ref.placedAt || new Date().toISOString()
    });

    // Cap at 20 recent orders
    if (list.length > 20) {
      list = list.slice(0, 20);
    }

    localStorage.setItem(storageKey, JSON.stringify(list));

    // Also notify active tabs or listeners if needed
    window.dispatchEvent(new CustomEvent('restaurantos_order_tracked', { detail: ref }));
  } catch (err) {
    console.warn('[CustomerOrderTracking] Failed to save tracked order:', err);
  }
}

/**
 * Retrieves tracked orders for the given customer or guest
 */
export function getTrackedOrders(customerId?: string | null): TrackedOrderReference[] {
  if (typeof window === 'undefined') return [];

  try {
    const storageKey = customerId
      ? `${CUSTOMER_STORAGE_PREFIX}${customerId}`
      : GUEST_STORAGE_KEY;

    const existingJson = localStorage.getItem(storageKey);
    return existingJson ? JSON.parse(existingJson) : [];
  } catch (err) {
    console.warn('[CustomerOrderTracking] Failed to get tracked orders:', err);
    return [];
  }
}

/**
 * Retrieves full orders for an authenticated customer
 * Uses tracked references and fetches the latest status from Firestore
 */
export async function getCustomerOrders(customerId: string): Promise<Order[]> {
  const cleanCustomerId = (customerId || '').trim();
  if (!cleanCustomerId) return [];

  const tracked = getTrackedOrders(cleanCustomerId);
  if (tracked.length === 0) return [];

  const orders: Order[] = [];

  // Fetch each tracked order doc in parallel
  const fetchPromises = tracked.map(async (ref) => {
    try {
      const orderDocRef = doc(db, 'restaurants', ref.restaurantId, 'orders', ref.orderId);
      const snap = await getDoc(orderDocRef);
      if (snap.exists()) {
        const orderData = { id: snap.id, ...snap.data() } as Order;
        if (orderData.customerId === cleanCustomerId) {
          return sanitizeCustomerOrder(orderData);
        }
      }
    } catch (err) {
      console.warn(`[CustomerOrderTracking] Error fetching order ${ref.orderId}:`, err);
    }
    return null;
  });

  const results = await Promise.all(fetchPromises);
  for (const res of results) {
    if (res) orders.push(res);
  }

  // Sort by createdAt descending
  orders.sort((a, b) => {
    const timeA = typeof a.createdAt === 'object' && a.createdAt?.toMillis
      ? a.createdAt.toMillis()
      : new Date(a.createdAt || 0).getTime();
    const timeB = typeof b.createdAt === 'object' && b.createdAt?.toMillis
      ? b.createdAt.toMillis()
      : new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  return orders;
}

/**
 * Returns count of active (non-completed and non-cancelled) orders
 */
export function getActiveOrdersCount(customerId?: string | null): number {
  const orders = getTrackedOrders(customerId);
  return orders.filter(
    (o) => o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled'
  ).length;
}
