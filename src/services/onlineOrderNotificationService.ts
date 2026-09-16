/**
 * Online Order Notification Service
 * 
 * Milestone 9 — Phase 3: Restaurant New Online Order Realtime Notification
 * 
 * Manages real-time detection of incoming online orders for authorized restaurant staff,
 * with deterministic duplicate prevention, initial-load suppression, reconnect protection,
 * and strict tenant isolation.
 * 
 * CRITICAL ARCHITECTURAL INVARIANTS:
 * 1. Zero order duplication — reacts strictly to existing orders created in Firestore.
 * 2. Initial Page Load Suppression — historical orders loaded on initial snapshot NEVER trigger alerts.
 * 3. Reconnect Protection — reconnected listeners retain known order IDs and do not re-announce past orders.
 * 4. Tenant Isolation — subscriptions are strictly partitioned under `/restaurants/{restaurantId}/orders`.
 * 5. Local State Separation — dismissal or acknowledgment NEVER mutates order status.
 */

import { collection, query, where, orderBy, onSnapshot, Unsubscribe, DocumentChange } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Order } from '../types/order';

// In-memory set of known order IDs per restaurant to prevent duplicate alerts across reconnects
const seenOrderIdsByRestaurant = new Map<string, Set<string>>();

/**
 * Retrieves the Set of seen order IDs for a specific restaurant tenant.
 */
function getSeenOrderIds(restaurantId: string): Set<string> {
  let seen = seenOrderIdsByRestaurant.get(restaurantId);
  if (!seen) {
    seen = new Set<string>();
    seenOrderIdsByRestaurant.set(restaurantId, seen);
  }
  return seen;
}

/**
 * Resets the seen order cache for a specific restaurant or all restaurants.
 * Primarily used for testing or clean tenant switching.
 */
export function resetSeenOrderCache(restaurantId?: string): void {
  if (restaurantId) {
    seenOrderIdsByRestaurant.delete(restaurantId);
  } else {
    seenOrderIdsByRestaurant.clear();
  }
}

export interface OnlineOrderNotificationListenerOptions {
  /**
   * Called whenever a genuinely new online order is created.
   */
  onNewOrder: (order: Order) => void;
  /**
   * Optional error callback.
   */
  onError?: (err: Error) => void;
}

/**
 * Subscribes to real-time incoming online orders for a specific restaurant.
 * 
 * Guarantees:
 * - Historical orders present on initial subscription load are indexed without triggering notifications.
 * - Only orders created after the listener is active trigger `onNewOrder`.
 * - Reconnect events or repeated Firestore snapshots never re-trigger alerts for existing orders.
 * - Non-online orders (e.g. dine-in, POS counter, captain orders) are ignored.
 */
export function subscribeToNewOnlineOrders(
  restaurantId: string,
  callbacks: OnlineOrderNotificationListenerOptions
): Unsubscribe {
  const cleanRestaurantId = restaurantId?.trim();
  if (!cleanRestaurantId) {
    if (callbacks.onError) {
      callbacks.onError(new Error('restaurantId is required to subscribe to online order notifications.'));
    }
    return () => {};
  }

  const seenOrderIds = getSeenOrderIds(cleanRestaurantId);
  let isInitialSnapshot = true;

  // Query only online orders in the tenant-scoped collection
  const ordersCol = collection(db, 'restaurants', cleanRestaurantId, 'orders');
  const q = query(
    ordersCol,
    where('source', '==', 'online'),
    orderBy('createdAt', 'desc')
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      // 1. Initial snapshot handling: index all existing historical orders
      if (isInitialSnapshot) {
        snapshot.docs.forEach((docSnap) => {
          seenOrderIds.add(docSnap.id);
        });
        isInitialSnapshot = false;
        return;
      }

      // 2. Subsequent snapshots: inspect document changes for genuinely new orders
      const docChanges = snapshot.docChanges ? snapshot.docChanges() : [];

      if (docChanges.length > 0) {
        docChanges.forEach((change: DocumentChange) => {
          if (change.type === 'added') {
            const orderData = change.doc.data() as Partial<Order>;
            const orderId = change.doc.id;

            // Only notify if order is from 'online' source and hasn't been announced yet
            if (orderData.source === 'online' && !seenOrderIds.has(orderId)) {
              seenOrderIds.add(orderId);

              const fullOrder: Order = {
                id: orderId,
                restaurantId: cleanRestaurantId,
                ...orderData
              } as Order;

              callbacks.onNewOrder(fullOrder);
            }
          }
        });
      } else {
        // Fallback for mock or direct snapshot emitters without docChanges helper
        snapshot.docs.forEach((docSnap) => {
          const orderId = docSnap.id;
          const orderData = docSnap.data() as Partial<Order>;

          if (orderData.source === 'online' && !seenOrderIds.has(orderId)) {
            seenOrderIds.add(orderId);

            const fullOrder: Order = {
              id: orderId,
              restaurantId: cleanRestaurantId,
              ...orderData
            } as Order;

            callbacks.onNewOrder(fullOrder);
          }
        });
      }
    },
    (err) => {
      if (!auth.currentUser) return;
      const errCode = (err as any)?.code;
      if (errCode === 'permission-denied' || errCode === 'unavailable') {
        console.warn('[RestaurantOS] Online order notification subscription notice:', (err as any)?.message);
      } else {
        console.error('[RestaurantOS] Online order notification subscription error:', err);
      }
      if (callbacks.onError) {
        callbacks.onError(err as Error);
      }
    }
  );

  return unsubscribe;
}
