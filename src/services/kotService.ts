import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  runTransaction,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { KOT, KOTItem, KOTStatus } from '../types/kot';
import { Order, OrderItem, OrderStatus } from '../types/order';
import { IKOTService } from './transactionInterfaces';
import { kotsPath, kotDocPath, orderDocPath, tableSessionDocPath } from '../utils/paths';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';
import { validateKOT, validateKOTStatusTransition, validateOrderStatusTransition } from '../utils/transactionValidation';
import { calculateAggregateOrderStatus } from '../utils/kotQueueHelpers';
import { idempotencyService } from './idempotencyService';
import { auditService } from './auditService';
import { orderFinalizationService } from './orderFinalizationService';
import { enforcePermission } from '../utils/permissions';
import { sanitizeFirestoreData } from '../utils/sanitize';
import { getApiUrl } from '../utils/apiConfig';

export interface CreateKOTFromOrderInput {
  restaurantId: string;
  orderId: string;
  items?: OrderItem[]; // Optional: if omitted, all items in order are included. For split/incremental KOTs, specify items.
  notes?: string;
  createdBy?: string;
  clientRequestId?: string; // Phase 2G idempotency preparation
}

/**
 * Helper to convert an OrderItem to a KOTItem kitchen snapshot.
 * Preserves itemId, nameSnapshot, shortNameSnapshot, quantity, notes, and modifiers.
 * Strips all financial calculations (unitPriceMinor, tax, discount, lineTotal)
 * to maintain strict separation of concerns (KOT is NOT a financial authority).
 */
export function createKOTItemFromOrderItem(orderItem: OrderItem): KOTItem {
  if (!orderItem.itemId || typeof orderItem.itemId !== 'string' || orderItem.itemId.trim() === '') {
    throw new Error('Cannot create KOT item: orderItem.itemId is missing or invalid.');
  }
  if (!orderItem.nameSnapshot || typeof orderItem.nameSnapshot !== 'string' || orderItem.nameSnapshot.trim() === '') {
    throw new Error('Cannot create KOT item: orderItem.nameSnapshot is missing or invalid.');
  }
  if (typeof orderItem.quantity !== 'number' || !Number.isInteger(orderItem.quantity) || orderItem.quantity <= 0) {
    throw new Error(`Cannot create KOT item: quantity must be an integer > 0, received: ${orderItem.quantity}`);
  }

  const kotItem: KOTItem = {
    itemId: orderItem.itemId.trim(),
    nameSnapshot: orderItem.nameSnapshot.trim(),
    quantity: orderItem.quantity
  };

  if (orderItem.shortNameSnapshot && orderItem.shortNameSnapshot.trim()) {
    kotItem.shortNameSnapshot = orderItem.shortNameSnapshot.trim();
  }

  if (orderItem.notes && orderItem.notes.trim()) {
    kotItem.notes = orderItem.notes.trim();
  }

  if (orderItem.modifiers && Array.isArray(orderItem.modifiers) && orderItem.modifiers.length > 0) {
    kotItem.modifiers = orderItem.modifiers.map(m => ({
      id: m.id,
      name: m.name,
      priceMinor: m.priceMinor
    }));
  }

  return kotItem;
}

/**
 * KOTService
 * 
 * Centralized Kitchen Order Ticket (KOT) & Kitchen Workflow Service for RestaurantOS.
 * 
 * CRITICAL ARCHITECTURAL INVARIANTS:
 * 1. Multi-Tenant Restaurant Isolation: Every query and mutation is strictly scoped
 *    under `restaurants/{restaurantId}/kots/{kotId}`.
 * 2. Identity Decoupling: auth.uid is NEVER assumed to be equal to restaurantId.
 * 3. Kitchen vs. Financial Authority Separation: KOT contains ONLY kitchen preparation data.
 *    KOT never performs financial calculations or recalculates taxes/discounts/grand totals.
 * 4. Historical Snapshot Immutability: KOT items snapshot item names, modifiers, and notes from
 *    the OrderItem. Subsequent live catalog mutations or order name changes do not alter existing KOTs.
 * 5. Order Eligibility & Order-Restaurant Matching: KOTs can only be created from valid, non-cancelled,
 *    non-draft (e.g. 'confirmed', 'sentToKitchen', 'preparing') orders belonging to the exact same restaurant.
 * 6. KOT Lifecycle State Machine: Strict enforcement of valid transitions:
 *    draft -> confirmed -> sentToKitchen -> preparing -> ready -> served
 *    cancellation is allowed from active states to 'cancelled' with explicit audit metadata.
 *    Terminal states ('served', 'cancelled') can NEVER transition further.
 * 7. Order Status vs KOT Status Independence: Order status and KOT status represent separate workflows.
 * 8. Table Session Relationship: Table session IDs are preserved for dine-in orders without closing or mutating
 *    the session prematurely.
 */
export class KOTService implements IKOTService {
  /**
   * Retrieves a single KOT by ID within a restaurant.
   */
  async getKOTById(restaurantId: string, kotId: string): Promise<KOT | null> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanKotId = kotId?.trim();
    if (!cleanRestaurantId || !cleanKotId) {
      throw new Error('restaurantId and kotId are required to fetch a KOT.');
    }

    try {
      const docRef = doc(db, kotDocPath(cleanRestaurantId, cleanKotId));
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return null;
      }
      return { id: snap.id, ...snap.data() } as KOT;
    } catch (err) {
      throw handleFirestoreError(err, OperationType.GET, kotDocPath(cleanRestaurantId, cleanKotId));
    }
  }

  /**
   * Retrieves all KOTs generated for a specific order.
   */
  async getKOTsForOrder(restaurantId: string, orderId: string): Promise<KOT[]> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to fetch KOTs for an order.');
    }

    try {
      const kotsCol = collection(db, kotsPath(cleanRestaurantId));
      const q = query(
        kotsCol,
        where('orderId', '==', cleanOrderId)
      );
      const snap = await getDocs(q);
      const docsList = snap && Array.isArray((snap as any).docs) ? (snap as any).docs : [];
      const kots = docsList.map((d: any) => ({ id: d.id, ...d.data() } as KOT));
      return kots.sort((a, b) => {
        const timeA = (a.createdAt as any)?.toMillis?.() || (a.createdAt ? new Date(a.createdAt as any).getTime() : 0);
        const timeB = (b.createdAt as any)?.toMillis?.() || (b.createdAt ? new Date(b.createdAt as any).getTime() : 0);
        return timeA - timeB;
      });
    } catch (err) {
      if ((err as any)?.message?.includes('Cannot read properties of undefined')) {
        return [];
      }
      throw handleFirestoreError(err, OperationType.LIST, kotsPath(cleanRestaurantId));
    }
  }

  /**
   * Retrieves all active (non-terminal: not served and not cancelled) KOTs for a restaurant.
   */
  async getActiveKOTs(restaurantId: string): Promise<KOT[]> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to fetch active KOTs.');
    }

    try {
      const kotsCol = collection(db, kotsPath(cleanRestaurantId));
      const activeStatuses: KOTStatus[] = ['confirmed', 'sentToKitchen', 'preparing', 'ready'];
      const q = query(
        kotsCol,
        where('status', 'in', activeStatuses)
      );
      const snap = await getDocs(q);
      const kots = snap.docs.map(d => ({ id: d.id, ...d.data() } as KOT));
      return kots.sort((a, b) => {
        const timeA = (a.createdAt as any)?.toMillis?.() || (a.createdAt ? new Date(a.createdAt as any).getTime() : 0);
        const timeB = (b.createdAt as any)?.toMillis?.() || (b.createdAt ? new Date(b.createdAt as any).getTime() : 0);
        return timeA - timeB;
      });
    } catch (err) {
      throw handleFirestoreError(err, OperationType.LIST, kotsPath(cleanRestaurantId));
    }
  }

  /**
   * Low-level method to persist a validated KOT entity into Firestore.
   */
  async createKOT(
    restaurantId: string,
    kotData: Omit<KOT, 'id' | 'createdAt' | 'updatedAt'>,
    clientRequestId?: string
  ): Promise<KOT> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('Valid restaurantId is required to create a KOT.');
    }

    if (kotData.restaurantId !== cleanRestaurantId) {
      throw new Error(
        `Payload restaurantId "${kotData.restaurantId}" does not match target restaurantId "${cleanRestaurantId}".`
      );
    }

    const validation = validateKOT(kotData);
    if (!validation.isValid) {
      throw new Error(`KOT validation failed: ${validation.error}`);
    }

    const cleanKey = clientRequestId?.trim();
    if (cleanKey) {
      const check = await idempotencyService.checkOrAcquire<KOT>(
        cleanRestaurantId,
        cleanKey,
        'create_kot',
        kotData
      );

      if (check.action === 'return_cached' && check.cachedResult) {
        return check.cachedResult;
      }
    }

    try {
      const kotsCol = collection(db, kotsPath(cleanRestaurantId));
      const newDocRef = doc(kotsCol);
      const now = new Date();

      const docPayload = sanitizeFirestoreData({
        ...kotData,
        id: newDocRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await setDoc(newDocRef, docPayload);

      const createdKot: KOT = {
        ...kotData,
        id: newDocRef.id,
        createdAt: now,
        updatedAt: now
      };

      if (cleanKey) {
        await idempotencyService.recordSuccess(
          cleanRestaurantId,
          cleanKey,
          'create_kot',
          kotData,
          createdKot.id,
          createdKot
        );
      }

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'kot',
        entityId: createdKot.id,
        action: 'kot_created',
        actorUid: kotData.createdBy || 'system',
        metadata: {
          kotNumber: kotData.kotNumber,
          orderId: kotData.orderId,
          tableId: kotData.tableId || null,
          status: kotData.status,
          itemCount: kotData.items.length
        }
      });

      return createdKot;
    } catch (err) {
      if (cleanKey) {
        await idempotencyService.recordFailure(
          cleanRestaurantId,
          cleanKey,
          (err as any)?.message || 'Failed to create KOT'
        );
      }
      throw handleFirestoreError(err, OperationType.CREATE, kotsPath(cleanRestaurantId));
    }
  }

  /**
   * High-level domain workflow to authoritatively create a KOT from an existing Order.
   * 
   * 1. Validates order existence and matching restaurantId.
   * 2. Validates order status eligibility (must not be 'draft', 'cancelled', or 'completed').
   * 3. Validates dine-in table session integrity if applicable.
   * 4. Converts OrderItems into KOTItems kitchen snapshots.
   * 5. Persists the KOT with initial status 'sentToKitchen' (or 'confirmed').
   * 6. Automatically transitions Order status to 'sentToKitchen' if Order is currently 'confirmed'.
   */
  async createKOTFromOrder(input: CreateKOTFromOrderInput): Promise<KOT> {
    const { restaurantId, orderId, items: selectedItems, notes, createdBy, clientRequestId } = input;
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();

    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to create a KOT from an order.');
    }

    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';
    if (typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication required to create a KOT.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch(getApiUrl('/api/kots/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          restaurantId: cleanRestaurantId,
          orderId: cleanOrderId,
          items: selectedItems || undefined,
          notes: notes || '',
          clientRequestId: clientRequestId || undefined
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || data?.error || `KOT creation failed with status ${response.status}`);
      }
      return data.kot as KOT;
    }

    await enforcePermission(cleanRestaurantId, 'create_orders');

    // 1. Fetch and validate the Order
    let orderDoc: Order;
    try {
      const orderRef = doc(db, orderDocPath(cleanRestaurantId, cleanOrderId));
      const orderSnap = await getDoc(orderRef);
      if (!orderSnap.exists()) {
        throw new Error(`Order "${cleanOrderId}" does not exist in restaurant "${cleanRestaurantId}".`);
      }
      orderDoc = { id: orderSnap.id, ...orderSnap.data() } as Order;
    } catch (err: any) {
      if (err.message && err.message.includes('does not exist')) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.GET, orderDocPath(cleanRestaurantId, cleanOrderId));
    }

    // 2. Verify restaurant ownership
    if (orderDoc.restaurantId !== cleanRestaurantId) {
      throw new Error(
        `Cross-tenant violation: Order "${cleanOrderId}" belongs to restaurant "${orderDoc.restaurantId}", not "${cleanRestaurantId}".`
      );
    }

    // 3. Verify Order status eligibility
    if (orderDoc.status === 'draft') {
      throw new Error(`Cannot create KOT from draft order. Order must be confirmed first.`);
    }
    if (orderDoc.status === 'cancelled') {
      throw new Error(`Cannot create KOT from cancelled order "${cleanOrderId}".`);
    }
    if (orderDoc.status === 'completed') {
      throw new Error(`Cannot create KOT from completed order "${cleanOrderId}".`);
    }

    // 4. Verify TableSession if dine-in
    if (orderDoc.orderType === 'dineIn' && orderDoc.tableSessionId) {
      try {
        const sessionRef = doc(db, tableSessionDocPath(cleanRestaurantId, orderDoc.tableSessionId));
        const sessionSnap = await getDoc(sessionRef);
        if (sessionSnap.exists()) {
          const sessionData = sessionSnap.data();
          if (sessionData.restaurantId !== cleanRestaurantId) {
            throw new Error(`TableSession does not belong to restaurant "${cleanRestaurantId}".`);
          }
        }
      } catch (err: any) {
        if (err.message && err.message.includes('does not belong')) {
          throw err;
        }
        // If fetch fails with permission or network, log or bubble
      }
    }

    // 5. Determine items to include
    const rawItemsToInclude: OrderItem[] = selectedItems && selectedItems.length > 0
      ? selectedItems
      : orderDoc.items;

    if (!rawItemsToInclude || rawItemsToInclude.length === 0) {
      throw new Error(`Cannot create KOT: Order "${cleanOrderId}" has no items.`);
    }

    // Check if an active KOT already exists for this exact order when no partial items are specified
    if (!selectedItems || selectedItems.length === 0) {
      const existingKots = await this.getKOTsForOrder(cleanRestaurantId, cleanOrderId);
      const activeExistingKot = existingKots.find((k) => k.status !== 'cancelled' && k.status !== 'draft');
      if (activeExistingKot && activeExistingKot.items.length === orderDoc.items.length) {
        // Return existing KOT idempotently
        return activeExistingKot;
      }
    }

    // 6. Convert to KOTItem snapshots (stripping financial fields, preserving kitchen metadata)
    const kotItems: KOTItem[] = rawItemsToInclude.map(createKOTItemFromOrderItem);

    // 7. Generate KOT Number
    const kotNumber = `KOT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const resolvedUserId = createdBy || auth.currentUser?.uid || 'system';

    const kotPayload: Omit<KOT, 'id' | 'createdAt' | 'updatedAt'> = {
      kotNumber,
      restaurantId: cleanRestaurantId,
      orderId: cleanOrderId,
      tableId: orderDoc.tableId || null,
      tableSessionId: orderDoc.tableSessionId || null,
      items: kotItems,
      notes: notes || orderDoc.notes || '',
      status: 'sentToKitchen',
      sentToKitchenAt: serverTimestamp(),
      createdBy: resolvedUserId,
      updatedBy: resolvedUserId
    };

    // 8. Persist KOT (with idempotency support)
    const createdKot = await this.createKOT(cleanRestaurantId, kotPayload, clientRequestId);

    // 9. If the Order is currently 'confirmed', advance Order status to 'sentToKitchen'
    if (orderDoc.status === 'confirmed') {
      try {
        const orderRef = doc(db, orderDocPath(cleanRestaurantId, cleanOrderId));
        await updateDoc(orderRef, {
          status: 'sentToKitchen',
          updatedBy: resolvedUserId,
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        // Log warning or propagate if critical
        console.warn(`Could not advance order ${cleanOrderId} status to sentToKitchen:`, err);
      }
    }

    return createdKot;
  }

  /**
   * Ensures that a confirmed order has an active KOT. If one is missing (e.g. after a network glitch or retry),
   * creates it and returns it. If already present, returns the existing KOT.
   */
  async ensureKOTForOrder(
    restaurantId: string,
    orderId: string,
    options?: { createdBy?: string; clientRequestId?: string }
  ): Promise<KOT> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required.');
    }

    const existingKots = await this.getKOTsForOrder(cleanRestaurantId, cleanOrderId);
    const activeKot = existingKots.find((k) => k.status !== 'cancelled');
    if (activeKot) {
      return activeKot;
    }

    return this.createKOTFromOrder({
      restaurantId: cleanRestaurantId,
      orderId: cleanOrderId,
      createdBy: options?.createdBy,
      clientRequestId: options?.clientRequestId || `req_ensure_kot_${cleanOrderId}`
    });
  }

  /**
   * Synchronizes and updates the parent Order status based on all sibling KOTs.
   */
  async syncParentOrderStatus(restaurantId: string, orderId: string, actorUid: string): Promise<OrderStatus | null> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) return null;

    try {
      const orderRef = doc(db, orderDocPath(cleanRestaurantId, cleanOrderId));
      const orderSnap = await getDoc(orderRef);
      if (!orderSnap || typeof orderSnap.exists !== 'function' || !orderSnap.exists()) return null;

      const orderData = orderSnap.data() as Order;
      if (orderData.status === 'completed' || orderData.status === 'cancelled') {
        return orderData.status;
      }

      const allKots = await this.getKOTsForOrder(cleanRestaurantId, cleanOrderId);
      const newStatus = calculateAggregateOrderStatus(orderData.status, allKots);

      if (newStatus !== orderData.status) {
        const transitionCheck = validateOrderStatusTransition(orderData.status, newStatus);
        if (transitionCheck.isValid) {
          await updateDoc(orderRef, {
            status: newStatus,
            updatedBy: actorUid || 'system',
            updatedAt: serverTimestamp()
          });

          await auditService.logEvent(cleanRestaurantId, {
            restaurantId: cleanRestaurantId,
            entityType: 'order',
            entityId: cleanOrderId,
            action: 'order_status_changed',
            actorUid: actorUid || 'system',
            metadata: {
              oldStatus: orderData.status,
              newStatus,
              reason: 'kot_status_aggregation'
            }
          });
        }
      }

      return newStatus;
    } catch (err) {
      console.warn(`Failed to synchronize order ${cleanOrderId} status from KOTs:`, err);
      return null;
    }
  }

  /**
   * Updates the status of a KOT following the strict KOT lifecycle state machine.
   * 
   * Valid transitions:
   * draft -> confirmed -> sentToKitchen -> preparing -> ready -> served
   * Cancellation is allowed from any active state via cancelKOT().
   */
  async updateKOTStatus(
    restaurantId: string,
    kotId: string,
    newStatus: KOTStatus,
    updatedBy: string,
    idempotencyKey?: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to update KOT status.');
    }
    await enforcePermission(cleanRestaurantId, 'update_kot_status');
    const cleanKotId = kotId?.trim();
    if (!cleanRestaurantId || !cleanKotId) {
      throw new Error('restaurantId and kotId are required to update KOT status.');
    }

    const cleanKey = idempotencyKey?.trim();
    if (cleanKey) {
      const check = await idempotencyService.checkOrAcquire<void>(
        cleanRestaurantId,
        cleanKey,
        'update_kot_status',
        { kotId: cleanKotId, newStatus, updatedBy }
      );
      if (check.action === 'return_cached') {
        return;
      }
    }

    // 1. Read + validate + mutate inside one Firestore transaction.
    // This prevents stale UI snapshots or double taps from skipping a lifecycle
    // state (for example preparing -> ready -> served in one race).
    const resolvedUserId = updatedBy || auth.currentUser?.uid || 'system';
    let kotBefore: KOT | null = null;
    let transitioned = false;

    try {
      const docRef = doc(db, kotDocPath(cleanRestaurantId, cleanKotId));

      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists()) {
          throw new Error(`KOT "${cleanKotId}" does not exist in restaurant "${cleanRestaurantId}".`);
        }

        const currentKot = { id: snap.id, ...snap.data() } as KOT;
        kotBefore = currentKot;

        const transitionValidation = validateKOTStatusTransition(currentKot.status, newStatus);
        if (!transitionValidation.isValid) {
          throw new Error(transitionValidation.error || 'Invalid KOT status transition.');
        }

        if (currentKot.status === newStatus) {
          return;
        }

        const updatePayload: Record<string, any> = {
          status: newStatus,
          updatedBy: resolvedUserId,
          updatedAt: serverTimestamp()
        };

        if (newStatus === 'sentToKitchen') {
          updatePayload.sentToKitchenAt = serverTimestamp();
        } else if (newStatus === 'preparing') {
          updatePayload.preparingAt = serverTimestamp();
        } else if (newStatus === 'ready') {
          updatePayload.readyAt = serverTimestamp();
        } else if (newStatus === 'served') {
          updatePayload.servedAt = serverTimestamp();
        }

        transaction.update(docRef, updatePayload);
        transitioned = true;
      });

      if (!kotBefore) {
        throw new Error(`KOT "${cleanKotId}" could not be loaded.`);
      }

      // A repeated request for the already-current status is a safe no-op.
      if (!transitioned) {
        if (cleanKey) {
          void idempotencyService.recordSuccess(
            cleanRestaurantId,
            cleanKey,
            'update_kot_status',
            { kotId: cleanKotId, newStatus, updatedBy },
            cleanKotId,
            undefined
          ).catch((error) => console.warn('[KOTService] Idempotency completion notice:', error));
        }
        return;
      }

      // The KOT status transaction is the user-visible critical path. Parent
      // aggregation, audit and finalization are eventual consistency work and
      // should not make every kitchen tap wait for several extra reads/writes.
      void auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'kot',
        entityId: cleanKotId,
        action: 'kot_status_changed',
        actorUid: resolvedUserId,
        metadata: {
          kotNumber: kotBefore.kotNumber,
          orderId: kotBefore.orderId,
          oldStatus: kotBefore.status,
          newStatus,
          updatedBy: resolvedUserId
        }
      }).catch((error) => console.warn('[KOTService] KOT audit notice:', error));

      if (cleanKey) {
        void idempotencyService.recordSuccess(
          cleanRestaurantId,
          cleanKey,
          'update_kot_status',
          { kotId: cleanKotId, newStatus, updatedBy },
          cleanKotId,
          undefined
        ).catch((error) => console.warn('[KOTService] Idempotency completion notice:', error));
      }

      void this.syncParentOrderStatus(
        cleanRestaurantId,
        kotBefore.orderId,
        resolvedUserId
      ).catch((error) => console.warn('[KOTService] Parent order sync notice:', error));

      if (newStatus === 'served' || newStatus === 'cancelled') {
        void orderFinalizationService.evaluateAndFinalizeOrderAndSession(
          cleanRestaurantId,
          kotBefore.orderId,
          resolvedUserId
        ).catch((error) => {
          console.warn('[KOTService] Background order finalization notice:', error);
        });
      }

    } catch (err) {
      if (cleanKey) {
        await idempotencyService.recordFailure(
          cleanRestaurantId,
          cleanKey,
          (err as any)?.message || 'Failed to update KOT status'
        );
      }
      throw handleFirestoreError(err, OperationType.UPDATE, kotDocPath(cleanRestaurantId, cleanKotId));
    }
  }

  /**
   * Explicitly cancels an active KOT with audit reason and timestamp.
   * Cancelled is a terminal state.
   */
  async cancelKOT(
    restaurantId: string,
    kotId: string,
    reason: string,
    cancelledBy: string,
    idempotencyKey?: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanKotId = kotId?.trim();
    if (!cleanRestaurantId || !cleanKotId) {
      throw new Error('restaurantId and kotId are required to cancel a KOT.');
    }

    await enforcePermission(cleanRestaurantId, 'update_kot_status');

    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('Cancellation reason is required to cancel a KOT.');
    }

    const cleanKey = idempotencyKey?.trim();
    if (cleanKey) {
      const check = await idempotencyService.checkOrAcquire<void>(
        cleanRestaurantId,
        cleanKey,
        'cancel_kot',
        { kotId: cleanKotId, reason, cancelledBy }
      );
      if (check.action === 'return_cached') {
        return;
      }
    }

    const kot = await this.getKOTById(cleanRestaurantId, cleanKotId);
    if (!kot) {
      if (cleanKey) {
        await idempotencyService.recordFailure(cleanRestaurantId, cleanKey, `KOT "${cleanKotId}" does not exist.`);
      }
      throw new Error(`KOT "${cleanKotId}" does not exist in restaurant "${cleanRestaurantId}".`);
    }

    const transitionValidation = validateKOTStatusTransition(kot.status, 'cancelled');
    if (!transitionValidation.isValid) {
      if (cleanKey) {
        await idempotencyService.recordFailure(cleanRestaurantId, cleanKey, transitionValidation.error || 'Invalid transition');
      }
      throw new Error(transitionValidation.error);
    }

    const resolvedUserId = cancelledBy || auth.currentUser?.uid || 'system';

    try {
      const docRef = doc(db, kotDocPath(cleanRestaurantId, cleanKotId));
      await updateDoc(docRef, {
        status: 'cancelled',
        cancellationReason: reason.trim(),
        cancelledAt: serverTimestamp(),
        cancelledBy: resolvedUserId,
        updatedBy: resolvedUserId,
        updatedAt: serverTimestamp()
      });

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'kot',
        entityId: cleanKotId,
        action: 'kot_cancelled',
        actorUid: resolvedUserId,
        metadata: {
          kotNumber: kot.kotNumber,
          orderId: kot.orderId,
          cancellationReason: reason.trim(),
          cancelledBy: resolvedUserId,
          oldStatus: kot.status
        }
      });

      if (cleanKey) {
        await idempotencyService.recordSuccess(
          cleanRestaurantId,
          cleanKey,
          'cancel_kot',
          { kotId: cleanKotId, reason, cancelledBy },
          cleanKotId,
          undefined
        );
      }

      // Synchronize parent order status after KOT cancellation
      await this.syncParentOrderStatus(cleanRestaurantId, kot.orderId, resolvedUserId);

      // Evaluate order completion and session closure
      try {
        await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
          cleanRestaurantId,
          kot.orderId,
          resolvedUserId
        );
      } catch (autoErr) {
        console.warn('[KOTService] Notice: auto-completion/session-closure check after KOT cancellation encountered:', autoErr);
      }
    } catch (err) {
      if (cleanKey) {
        await idempotencyService.recordFailure(
          cleanRestaurantId,
          cleanKey,
          (err as any)?.message || 'Failed to cancel KOT'
        );
      }
      throw handleFirestoreError(err, OperationType.UPDATE, kotDocPath(cleanRestaurantId, cleanKotId));
    }
  }

  /**
   * Partially cancels specific quantities of items in a KOT.
   * Preserves historical ordered quantities and synchronizes the change
   * authoritatively to the parent Order, inventory, and billing.
   * 
   * Example: 10 Biryani ordered, 5 available.
   * Staff keeps 5 to prepare and cancels 5.
   */
  async partiallyCancelKOTItems(
    restaurantId: string,
    kotId: string,
    cancellations: { itemId: string; cancelledQuantity: number; reason: string }[],
    cancelledBy: string,
    idempotencyKey?: string
  ): Promise<KOT> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanKotId = kotId?.trim();
    if (!cleanRestaurantId || !cleanKotId) {
      throw new Error('restaurantId and kotId are required to partially cancel KOT items.');
    }

    if (!cancellations || cancellations.length === 0) {
      throw new Error('Cancellations array must not be empty.');
    }

    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';
    if (typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to partially cancel KOT items.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch(getApiUrl('/api/kots/partial-cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          restaurantId: cleanRestaurantId,
          kotId: cleanKotId,
          cancellations,
          clientRequestId: idempotencyKey
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.kot) {
        throw new Error(payload?.message || 'Partial KOT cancellation failed.');
      }
      return payload.kot as KOT;
    }

    // Item-level cancellation is an order cancellation operation, not a KOT lifecycle transition.
    // Captain/waiter is authorized for this action; the server endpoint independently verifies
    // the authenticated restaurant role before executing the trusted write.
    await enforcePermission(cleanRestaurantId, 'cancel_orders');

    const cleanKey = idempotencyKey?.trim();
    if (cleanKey) {
      const check = await idempotencyService.checkOrAcquire<KOT>(
        cleanRestaurantId,
        cleanKey,
        'partially_cancel_kot_items',
        { kotId: cleanKotId, cancellations, cancelledBy }
      );
      if (check.action === 'return_cached' && check.cachedResult) {
        return check.cachedResult;
      }
    }

    const kot = await this.getKOTById(cleanRestaurantId, cleanKotId);
    if (!kot) {
      if (cleanKey) {
        await idempotencyService.recordFailure(cleanRestaurantId, cleanKey, `KOT "${cleanKotId}" does not exist.`);
      }
      throw new Error(`KOT "${cleanKotId}" does not exist in restaurant "${cleanRestaurantId}".`);
    }

    if (kot.status === 'cancelled') {
      throw new Error(`Cannot cancel items from already cancelled KOT "${cleanKotId}".`);
    }
    if (kot.status === 'served') {
      throw new Error(`Cannot cancel items from already served KOT "${cleanKotId}".`);
    }

    const resolvedUserId = cancelledBy || auth.currentUser?.uid || 'system';
    const now = new Date();

    // Map cancellations by itemId
    const cancelMap = new Map<string, { qty: number; reason: string }>();
    for (const c of cancellations) {
      const id = c.itemId?.trim();
      if (id && c.cancelledQuantity > 0) {
        const existing = cancelMap.get(id);
        const newQty = (existing?.qty || 0) + c.cancelledQuantity;
        cancelMap.set(id, { qty: newQty, reason: c.reason || existing?.reason || 'Cancelled by kitchen staff' });
      }
    }

    // Process KOT items
    const updatedKotItems: KOTItem[] = kot.items.map((item) => {
      const cancelReq = cancelMap.get(item.itemId);
      if (!cancelReq || cancelReq.qty <= 0) {
        return { ...item };
      }

      const availableToCancel = item.quantity;
      if (cancelReq.qty > availableToCancel) {
        throw new Error(
          `Cannot cancel ${cancelReq.qty} of "${item.nameSnapshot}". Only ${availableToCancel} active in KOT.`
        );
      }

      const originalQuantity = item.originalQuantity !== undefined ? item.originalQuantity : item.quantity;
      const newlyCancelled = cancelReq.qty;
      const cancelledQuantity = (item.cancelledQuantity || 0) + newlyCancelled;
      const remainingQuantity = item.quantity - newlyCancelled;

      return {
        ...item,
        quantity: remainingQuantity,
        originalQuantity,
        cancelledQuantity,
        cancellationReason: cancelReq.reason,
        cancelledAt: now,
        cancelledBy: resolvedUserId
      };
    });

    const activeItems = updatedKotItems.filter((i) => i.quantity > 0);
    const isAllCancelled = activeItems.length === 0;
    const newKotStatus: KOTStatus = isAllCancelled ? 'cancelled' : kot.status;

    const kotRef = doc(db, kotDocPath(cleanRestaurantId, cleanKotId));
    const kotUpdatePayload: Record<string, any> = {
      items: updatedKotItems,
      status: newKotStatus,
      updatedAt: serverTimestamp(),
      updatedBy: resolvedUserId
    };

    if (isAllCancelled) {
      kotUpdatePayload.cancellationReason = cancellations[0]?.reason || 'All items in KOT cancelled';
      kotUpdatePayload.cancelledAt = serverTimestamp();
      kotUpdatePayload.cancelledBy = resolvedUserId;
    }

    const sanitizedKotUpdate = sanitizeFirestoreData(kotUpdatePayload);
    await runTransaction(db, async (transaction) => {
      const latestSnap = await transaction.get(kotRef);
      if (!latestSnap.exists()) {
        throw new Error(`KOT "${cleanKotId}" no longer exists.`);
      }

      const latestKot = latestSnap.data() as KOT;
      if (latestKot.restaurantId !== cleanRestaurantId || latestKot.orderId !== kot.orderId) {
        throw new Error('Cross-tenant KOT mutation rejected.');
      }
      if (latestKot.status === 'served' || latestKot.status === 'cancelled') {
        throw new Error(`KOT "${cleanKotId}" can no longer be partially cancelled from status "${latestKot.status}".`);
      }

      if (!Array.isArray(latestKot.items) || latestKot.items.length !== updatedKotItems.length) {
        throw new Error('KOT changed concurrently. Please retry the cancellation.');
      }

      const latestById = new Map(latestKot.items.map((item) => [item.itemId, item]));
      for (const proposed of updatedKotItems) {
        const latest = latestById.get(proposed.itemId);
        if (!latest) throw new Error('KOT changed concurrently. Please retry the cancellation.');

        const proposedQty = Number(proposed.quantity);
        const latestQty = Number(latest.quantity);
        const proposedCancelled = Number(proposed.cancelledQuantity || 0);
        const latestCancelled = Number(latest.cancelledQuantity || 0);

        if (!Number.isInteger(proposedQty) || proposedQty < 0 || proposedQty > latestQty) {
          throw new Error(`Invalid partial cancellation quantity for "${proposed.nameSnapshot}". Please retry.`);
        }
        if (!Number.isInteger(proposedCancelled) || proposedCancelled < latestCancelled) {
          throw new Error(`Invalid cancelled quantity for "${proposed.nameSnapshot}". Please retry.`);
        }
      }

      transaction.update(kotRef, sanitizedKotUpdate);
    });

    const updatedKot: KOT = {
      ...kot,
      ...kotUpdatePayload,
      updatedAt: now
    };

    // Audit log
    await auditService.logEvent(cleanRestaurantId, {
      restaurantId: cleanRestaurantId,
      entityType: 'kot',
      entityId: cleanKotId,
      action: 'kot_items_partially_cancelled',
      actorUid: resolvedUserId,
      metadata: {
        kotNumber: kot.kotNumber,
        orderId: kot.orderId,
        cancellations,
        isAllCancelled,
        cancelledBy: resolvedUserId
      }
    });

    // Authoritatively synchronize parent Order items, billing, and inventory
    try {
      const { orderService } = await import('./orderService');
      await orderService.partiallyCancelOrderItems(
        cleanRestaurantId,
        kot.orderId,
        cancellations.map((c) => ({
          itemId: c.itemId,
          cancelledQuantity: c.cancelledQuantity,
          reason: c.reason
        })),
        resolvedUserId,
        cleanKey ? `${cleanKey}_order_sync` : undefined
      );
    } catch (orderSyncErr) {
      console.warn('[KOTService] Parent order partial cancellation synchronization notice:', orderSyncErr);
    }

    // Synchronize parent order status
    await this.syncParentOrderStatus(cleanRestaurantId, kot.orderId, resolvedUserId);

    // Evaluate order completion and session closure if KOT became cancelled
    try {
      await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
        cleanRestaurantId,
        kot.orderId,
        resolvedUserId
      );
    } catch (autoErr) {
      console.warn('[KOTService] Finalization notice after partial KOT cancellation:', autoErr);
    }

    if (cleanKey) {
      await idempotencyService.recordSuccess(
        cleanRestaurantId,
        cleanKey,
        'partially_cancel_kot_items',
        { kotId: cleanKotId, cancellations, cancelledBy },
        cleanKotId,
        updatedKot
      );
    }

    return updatedKot;
  }

  /**
   * Subscribes to real-time active KOTs for a specific restaurant.
   * Scoped strictly to the restaurant's KOTs subcollection.
   */
  subscribeToKitchenKOTs(
    restaurantId: string,
    onUpdate: (kots: KOT[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to subscribe to kitchen KOTs.');
    }

    const kotsCol = collection(db, kotsPath(cleanRestaurantId));
    const activeStatuses: KOTStatus[] = ['confirmed', 'sentToKitchen', 'preparing', 'ready'];
    const q = query(
      kotsCol,
      where('status', 'in', activeStatuses)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const kots = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        } as KOT));
        kots.sort((a, b) => {
          const timeA = (a.createdAt as any)?.toMillis?.() || (a.createdAt ? new Date(a.createdAt as any).getTime() : 0);
          const timeB = (b.createdAt as any)?.toMillis?.() || (b.createdAt ? new Date(b.createdAt as any).getTime() : 0);
          return timeA - timeB;
        });
        onUpdate(kots);
      },
      (error) => {
        const errCode = (error as any)?.code;
        if (errCode === 'permission-denied' || errCode === 'unavailable' || errCode === 'failed-precondition') {
          console.warn('[RestaurantOS] Kitchen KOTs subscription notice (permission/offline/index):', (error as any)?.message);
          onUpdate([]);
        }
        const handledError = handleFirestoreError(error, OperationType.LIST, kotsPath(cleanRestaurantId));
        if (onError) {
          onError(handledError);
        } else {
          console.warn('Kitchen KOTs subscription warning:', handledError.message);
        }
      }
    );
  }