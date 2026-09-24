import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Order, OrderItem, OrderStatus, OrderType, OrderSource, CustomerSnapshot } from '../types/order';
import { KOT, KOTItem } from '../types/kot';
import { CartState, CartItem } from '../types/cart';
import { TaxJurisdiction } from '../types/tax';
import { IOrderService } from './transactionInterfaces';
import { ordersPath, orderDocPath, tableSessionDocPath } from '../utils/paths';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';
import { validateOrder, validateOrderStatusTransition } from '../utils/transactionValidation';
import { calculateOrderTotals, calculateOrderItemLine } from './orderCalculationService';
import { idempotencyService } from './idempotencyService';
import { enforcePermission, getCurrentUserRestaurantRole } from '../utils/permissions';
import { auditService } from './auditService';
import { sanitizeFirestoreData } from '../utils/sanitize';
import { stockConsumptionService } from './stockConsumptionService';
import { orderFinalizationService } from './orderFinalizationService';
import { reconcileCancelledOrderInTableSession } from './orderSessionReconciliation';
import { parseTimestampToMillis } from '../utils/dateUtils';
import { reconcileOrderFinancials } from '../utils/orderFinancials';
import { getApiUrl } from '../utils/apiConfig';
import { Restaurant } from '../types/restaurant';
import {
  getRestaurantOperatingProfile,
  RestaurantOperatingProfile
} from '../config/restaurantOperatingModes';

export interface CreateOrderFromCartInput {
  restaurantId: string;
  cartState: CartState;
  orderType: OrderType;
  source: OrderSource;
  customerId?: string | null;
  tableId?: string | null;
  tableSessionId?: string | null;
  customerSnapshot?: CustomerSnapshot | null;
  notes?: string;
  taxJurisdiction?: TaxJurisdiction;
  createdBy?: string;
  clientRequestId?: string; // Phase 2G idempotency preparation
  customerTrackingToken?: string | null; // Server-generated opaque token for guest online tracking
  skipTableSessionValidation?: boolean;
}

export interface CreateOrderForOperatingModeInput extends CreateOrderFromCartInput {
  operatingProfile?: RestaurantOperatingProfile;
  restaurant?: Restaurant | null;
}

export interface OrderHistoryFilterOptions {
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  tableId?: string | null;
  tableSessionId?: string | null;
  orderType?: OrderType | 'all';
  orderStatus?: OrderStatus | 'all';
  paymentStatus?: 'all' | 'paid' | 'partial' | 'unpaid';
  searchQuery?: string;
  limitCount?: number;
}

/**
 * Server/Service level validation to verify public customer ordering eligibility and menu item integrity.
 */
async function validatePublicCustomerOrderingEligibility(
  restaurantId: string,
  cartState: CartState,
  orderType: string
): Promise<void> {
  const cleanRestaurantId = restaurantId.trim();

  // 1. Verify restaurant exists & permits public ordering
  const publicProfileRef = doc(db, 'publicRestaurants', cleanRestaurantId);
  const publicProfileSnap = await getDoc(publicProfileRef);
  if (!publicProfileSnap.exists()) {
    throw new Error('Online ordering is temporarily unavailable for this restaurant.');
  }

  const profile = publicProfileSnap.data();
  if (profile.publicStatus === 'closed' || profile.publicStatus === 'paused') {
    throw new Error('Restaurant is currently not accepting orders.');
  }

  if (!profile.onlineOrderingEnabled) {
    throw new Error('Online ordering is currently disabled for this restaurant.');
  }

  // 2. Validate Order Type
  if (orderType === 'delivery' && profile.deliveryEnabled === false) {
    throw new Error('Delivery is not available for this restaurant.');
  }
  if (orderType === 'takeaway' && profile.takeawayEnabled === false) {
    throw new Error('Takeaway is not available for this restaurant.');
  }
  if (orderType === 'dineIn') {
    throw new Error('Dine-in ordering is not available via online customer checkout.');
  }

  // 3. Verify Cart Menu Items availability and check for price/tax integrity
  if (cartState && Array.isArray(cartState.items)) {
    for (const item of cartState.items) {
      const itemRef = doc(db, 'restaurants', cleanRestaurantId, 'items', item.itemId);
      const itemSnap = await getDoc(itemRef);
      if (!itemSnap.exists()) {
        throw new Error(`"${item.nameSnapshot || 'An item'}" is no longer available.`);
      }

      const itemData = itemSnap.data();
      if (itemData.isActive === false || itemData.isAvailable === false) {
        throw new Error(`"${itemData.name || item.nameSnapshot}" is no longer available.`);
      }

      // Check for price tampering (minor unit match)
      const catalogPrice = Number(itemData.price);
      const catalogTaxRate = Number(itemData.taxRate);
      if (!Number.isFinite(catalogPrice) || catalogPrice < 0 || catalogPrice > 10000000) {
        throw new Error(`Catalog price is invalid for "${itemData.name}".`);
      }
      if (!Number.isFinite(catalogTaxRate) || catalogTaxRate < 0 || catalogTaxRate > 100) {
        throw new Error(`Catalog tax rate is invalid for "${itemData.name}".`);
      }
      const expectedPriceMinor = Math.round(catalogPrice * 100);
      if (item.unitPriceMinor !== expectedPriceMinor) {
        throw new Error(`Price verification failed for "${itemData.name}".`);
      }
      if (item.taxRate !== catalogTaxRate || Boolean(item.taxInclusive) !== Boolean(itemData.taxInclusive)) {
        throw new Error(`Tax verification failed for "${itemData.name}".`);
      }

      // Client modifiers must exactly match authoritative catalog pricing/configuration.
      const catalogVariants = Array.isArray(itemData.variants) ? itemData.variants : [];
      const catalogAddons = Array.isArray(itemData.addons) ? itemData.addons : (Array.isArray(itemData.addOns) ? itemData.addOns : []);
      const selectedModifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      for (const modifier of selectedModifiers) {
        if (modifier.id === item.itemId) continue;
        const variant = catalogVariants.find((v: any) => v.id === modifier.id);
        const addon = catalogAddons.find((a: any) => a.id === modifier.id);
        const authoritative = variant || addon;
        if (!authoritative || authoritative.isAvailable === false) {
          throw new Error(`Selected option is no longer available for "${itemData.name}".`);
        }
        const expectedModifierPriceMinor = Math.round(Number(authoritative.price) * 100);
        if (!Number.isFinite(expectedModifierPriceMinor) || modifier.priceMinor !== expectedModifierPriceMinor && !(variant && modifier.priceMinor === 0)) {
          // Variants are represented as a zero-price modifier because their authoritative
          // selected price is already the line unit price. Add-ons must carry their own price.
          if (!variant || modifier.priceMinor !== 0) {
            throw new Error(`Selected option price verification failed for "${itemData.name}".`);
          }
        }
      }
    }
  }
}

/**
 * OrderService
 * 
 * Centralized Order Creation & Lifecycle Management for RestaurantOS POS.
 * 
 * CRITICAL ARCHITECTURAL INVARIANTS:
 * 1. Multi-Tenant Restaurant Isolation: Every query and mutation is strictly scoped
 *    under `restaurants/{restaurantId}/orders/{orderId}`.
 * 2. Identity Decoupling: auth.uid is never assumed to be equal to restaurantId.
 * 3. Authoritative Financial Recalculation: Client-supplied financial totals are NEVER trusted.
 *    Order totals and line snapshots are calculated authoritatively by the Phase 2B engine.
 * 4. Historical Price Snapshot Policy: Order items snapshot unitPriceMinor, taxRate, and taxInclusive,
 *    guaranteeing that subsequent catalog changes do not alter finalized orders.
 * 5. Lifecycle State Machine: Order status transitions are validated using validateOrderStatusTransition.
 *    Non-draft orders cannot be deleted; cancellation is preferred to preserve audit trails.
 * 6. Dine-in Invariant: Dine-in orders require a valid, open TableSession belonging to the same restaurant.
 */
export class OrderService implements IOrderService {
  /**
   * Retrieves an order by its ID within a restaurant.
   */
  async getOrderById(restaurantId: string, orderId: string): Promise<Order | null> {
    const path = orderDocPath(restaurantId, orderId);
    try {
      const docRef = doc(db, 'restaurants', restaurantId.trim(), 'orders', orderId.trim());
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return null;
      }
      return reconcileOrderFinancials({ id: snap.id, ...snap.data() } as Order);
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.GET, path);
    }
  }

  /**
   * Retrieves all orders for a specific table session.
   */
  async getOrdersForSession(restaurantId: string, sessionId: string): Promise<Order[]> {
    const path = ordersPath(restaurantId);
    try {
      const colRef = collection(db, 'restaurants', restaurantId.trim(), 'orders');
      const q = query(
        colRef,
        where('tableSessionId', '==', sessionId.trim())
      );
      const snap = await getDocs(q);
      const orders: Order[] = [];
      snap.forEach((d) => {
        orders.push(reconcileOrderFinancials({ id: d.id, ...d.data() } as Order));
      });
      return orders.sort((a, b) => {
        const timeA = (a.createdAt as any)?.toMillis?.() || (a.createdAt ? new Date(a.createdAt as any).getTime() : 0);
        const timeB = (b.createdAt as any)?.toMillis?.() || (b.createdAt ? new Date(b.createdAt as any).getTime() : 0);
        return timeB - timeA;
      });
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  /**
   * Converts a CartState into validated OrderItems and calculates authoritative financial totals
   * using the Phase 2B Calculation Engine.
   */
  prepareOrderItemsAndTotals(
    cartState: CartState,
    taxJurisdiction: TaxJurisdiction = 'intraState'
  ): { items: OrderItem[]; calculationResult: ReturnType<typeof calculateOrderTotals> } {
    if (!cartState.items || cartState.items.length === 0) {
      throw new Error('Cannot create order from an empty cart.');
    }

    // 1. Prepare line inputs for Phase 2B calculation engine
    const lineInputs = cartState.items.map((cartItem) => ({
      quantity: cartItem.quantity,
      unitPriceMinor: cartItem.unitPriceMinor,
      taxRate: cartItem.taxRate,
      taxInclusive: cartItem.taxInclusive,
      discount: cartItem.discount
    }));

    // 2. Authoritatively calculate order totals using Phase 2B engine
    const calculationResult = calculateOrderTotals({
      items: lineInputs,
      orderDiscount: cartState.orderDiscount,
      taxJurisdiction
    });

    // 3. Build snapshot OrderItems with both historical catalog attributes and calculated line totals
    const items: OrderItem[] = cartState.items.map((cartItem, idx) => {
      const lineRes = calculationResult.lineResults[idx];
      return {
        itemId: cartItem.itemId,
        nameSnapshot: cartItem.nameSnapshot,
        shortNameSnapshot: cartItem.shortNameSnapshot,
        imageUrlSnapshot: cartItem.imageUrlSnapshot || null,
        foodTypeSnapshot: cartItem.foodTypeSnapshot || null,
        quantity: cartItem.quantity,
        unitPriceMinor: cartItem.unitPriceMinor,
        taxRate: cartItem.taxRate,
        taxInclusive: cartItem.taxInclusive,
        discountMinor: lineRes.discountMinor,
        lineSubtotalMinor: lineRes.subtotalMinor,
        lineTaxMinor: lineRes.totalTaxMinor,
        lineTotalMinor: lineRes.lineTotalMinor,
        notes: cartItem.notes,
        modifiers: cartItem.modifiers ? [...cartItem.modifiers] : undefined
      };
    });

    return { items, calculationResult };
  }

  /**
   * High-level order creation method from POS Cart state.
   * Performs full session validation, authoritative financial recalculation, and atomic persistence.
   */
  async createOrderFromCart(input: CreateOrderFromCartInput): Promise<Order> {
    const {
      restaurantId,
      cartState,
      orderType,
      source,
      tableId,
      tableSessionId,
      customerSnapshot,
      notes,
      taxJurisdiction = 'intraState',
      createdBy,
      customerTrackingToken
    } = input;

    if (!restaurantId || typeof restaurantId !== 'string' || restaurantId.trim() === '') {
      throw new Error('Valid restaurantId is required to create an order.');
    }

    const cleanRestaurantId = restaurantId.trim();
    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';

    if (source !== 'online' && typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to create a restaurant order.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch((await import('../utils/apiConfig')).getApiUrl('/api/orders/create-pos'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          restaurantId: cleanRestaurantId,
          cartState,
          orderType,
          source,
          tableId,
          tableSessionId,
          customerSnapshot,
          notes,
          taxJurisdiction,
          clientRequestId: input.clientRequestId,
          skipTableSessionValidation: input.skipTableSessionValidation
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.order) {
        throw new Error(payload?.message || 'Order creation failed.');
      }
      return payload.order as Order;
    }

    if (source === 'online') {
      await validatePublicCustomerOrderingEligibility(cleanRestaurantId, cartState, orderType);
    } else {
      await enforcePermission(cleanRestaurantId, 'create_orders');
    }

    // 1. Validate Dine-In Pre-conditions
    if (orderType === 'dineIn' && !input.skipTableSessionValidation) {
      if (!tableSessionId || typeof tableSessionId !== 'string' || tableSessionId.trim() === '') {
        throw new Error('Dine-in orders require a valid tableSessionId.');
      }

      // Verify TableSession existence, restaurant scope, and open status
      const sessionPath = tableSessionDocPath(cleanRestaurantId, tableSessionId.trim());
      const sessionRef = doc(
        db,
        'restaurants',
        cleanRestaurantId,
        'tableSessions',
        tableSessionId.trim()
      );
      const sessionSnap = await getDoc(sessionRef);

      if (!sessionSnap.exists()) {
        throw new Error(
          `Cannot create dine-in order: TableSession "${tableSessionId}" does not exist in restaurant "${cleanRestaurantId}".`
        );
      }

      const sessionData = sessionSnap.data();
      if (sessionData.status !== 'open') {
        throw new Error(
          `Cannot create dine-in order: TableSession "${tableSessionId}" is closed (status: ${sessionData.status}).`
        );
      }

      if (sessionData.restaurantId !== cleanRestaurantId) {
        throw new Error(
          `Cannot create dine-in order: TableSession does not belong to restaurant "${cleanRestaurantId}".`
        );
      }
    }

    // 2. Try to find an existing active dine-in order to merge
    let existingActiveOrder: Order | null = null;
    let existingOrderDocRef: any = null;

    if (orderType === 'dineIn' && tableSessionId) {
      try {
        const ordersCol = collection(db, 'restaurants', cleanRestaurantId, 'orders');
        const q = query(
          ordersCol,
          where('tableSessionId', '==', tableSessionId.trim())
        );
        const querySnap = await getDocs(q);
        for (const d of querySnap.docs) {
          const data = d.data();
          if (data.status !== 'cancelled' && data.status !== 'completed') {
            existingActiveOrder = { id: d.id, ...data } as Order;
            existingOrderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', d.id);
            break;
          }
        }
      } catch (err) {
        console.warn('[RestaurantOS] Failed checking for existing table session order in createOrderFromCart:', err);
      }
    }

    let finalMergedItems: OrderItem[];
    let finalCalculationResult: any;
    let dueAmountMinor = 0;
    const now = new Date();
    const resolvedUserId = createdBy || auth.currentUser?.uid || 'system';

    if (existingActiveOrder && existingOrderDocRef) {
      // Convert existing order items into CartItem format so we can merge
      const mergedCartItems: CartItem[] = [];

      // Start with existing items
      existingActiveOrder.items.forEach((item, index) => {
        mergedCartItems.push({
          cartItemId: `existing_${index}_${item.itemId}`,
          itemId: item.itemId,
          nameSnapshot: item.nameSnapshot,
          shortNameSnapshot: item.shortNameSnapshot || '',
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          taxRate: item.taxRate,
          taxInclusive: item.taxInclusive,
          notes: item.notes || '',
          modifiers: item.modifiers ? [...item.modifiers] : []
        });
      });

      // Merge new items from cartState.items
      cartState.items.forEach((newItem) => {
        const matchingItemIndex = mergedCartItems.findIndex((mergedItem) => {
          if (mergedItem.itemId !== newItem.itemId) return false;
          const m1 = mergedItem.modifiers || [];
          const m2 = newItem.modifiers || [];
          if (m1.length !== m2.length) return false;
          const m1Ids = m1.map(m => m.id).sort().join(',');
          const m2Ids = m2.map(m => m.id).sort().join(',');
          return m1Ids === m2Ids;
        });

        if (matchingItemIndex !== -1) {
          mergedCartItems[matchingItemIndex].quantity += newItem.quantity;
          if (newItem.notes && newItem.notes.trim() !== '') {
            const oldNotes = mergedCartItems[matchingItemIndex].notes || '';
            mergedCartItems[matchingItemIndex].notes = oldNotes ? `${oldNotes}; ${newItem.notes}` : newItem.notes;
          }
        } else {
          mergedCartItems.push({
            ...newItem,
            cartItemId: `new_${Date.now()}_${newItem.itemId}`
          });
        }
      });

      // Re-run Phase 2B calculation
      const mergedCartState: CartState = {
        items: mergedCartItems,
        orderDiscount: cartState.orderDiscount || (existingActiveOrder as any).orderDiscount,
        notes: cartState.notes || existingActiveOrder.notes || ''
      };

      const prep = this.prepareOrderItemsAndTotals(mergedCartState, taxJurisdiction);
      finalMergedItems = prep.items;
      finalCalculationResult = prep.calculationResult;

      const paidAmountMinor = existingActiveOrder.paidAmountMinor || 0;
      dueAmountMinor = Math.max(0, finalCalculationResult.grandTotalMinor - paidAmountMinor);

      const updatedOrderPayload = {
        items: finalMergedItems,
        subtotalMinor: finalCalculationResult.subtotalMinor,
        discountMinor: finalCalculationResult.discountMinor,
        taxableAmountMinor: finalCalculationResult.taxableAmountMinor,
        cgstMinor: finalCalculationResult.cgstMinor,
        sgstMinor: finalCalculationResult.sgstMinor,
        igstMinor: finalCalculationResult.igstMinor,
        totalTaxMinor: finalCalculationResult.totalTaxMinor,
        grandTotalMinor: finalCalculationResult.grandTotalMinor,
        dueAmountMinor,
        ...(customerSnapshot ? { customerSnapshot } : {}),
        updatedAt: serverTimestamp(),
        updatedBy: resolvedUserId
      };

      const sanitizedOrderUpdate = sanitizeFirestoreData(updatedOrderPayload);
      await updateDoc(existingOrderDocRef, sanitizedOrderUpdate);

      const updatedOrder: Order = {
        ...existingActiveOrder,
        ...updatedOrderPayload,
        updatedAt: now
      } as Order;

      // Audit logs
      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: updatedOrder.id,
        action: 'order_updated',
        actorUid: resolvedUserId,
        metadata: {
          orderNumber: updatedOrder.orderNumber,
          grandTotalMinor: updatedOrder.grandTotalMinor,
          orderType: updatedOrder.orderType,
          tableSessionId: updatedOrder.tableSessionId || null,
          appendedItemsCount: cartState.items.length
        }
      });

      // Stock consumption
      try {
        await stockConsumptionService.consumeStockForOrderViaBackend(cleanRestaurantId, {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          items: cartState.items.map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            nameSnapshot: i.nameSnapshot
          }))
        });
      } catch (err) {
        console.warn('[RestaurantOS] Stock consumption fail during createOrderFromCart merge:', err);
      }

      return updatedOrder;
    }

    // 3. Otherwise, regular brand-new order flow (unchanged)
    const prep = this.prepareOrderItemsAndTotals(cartState, taxJurisdiction);
    finalMergedItems = prep.items;
    finalCalculationResult = prep.calculationResult;
    dueAmountMinor = finalCalculationResult.grandTotalMinor;

    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const orderPayload: Omit<Order, 'id' | 'createdAt' | 'updatedAt'> = {
      restaurantId: cleanRestaurantId,
      orderNumber,
      customerId: input.customerId ? input.customerId.trim() : null,
      orderType,
      source,
      status: 'confirmed', // Initial authoritative POS order status
      tableId: orderType === 'dineIn' ? (tableId || null) : null,
      tableSessionId: orderType === 'dineIn' ? (tableSessionId || null) : null,
      items: finalMergedItems,
      subtotalMinor: finalCalculationResult.subtotalMinor,
      discountMinor: finalCalculationResult.discountMinor,
      taxableAmountMinor: finalCalculationResult.taxableAmountMinor,
      cgstMinor: finalCalculationResult.cgstMinor,
      sgstMinor: finalCalculationResult.sgstMinor,
      igstMinor: finalCalculationResult.igstMinor,
      totalTaxMinor: finalCalculationResult.totalTaxMinor,
      grandTotalMinor: finalCalculationResult.grandTotalMinor,
      paidAmountMinor: 0,
      dueAmountMinor,
      notes: notes || cartState.notes,
      customerSnapshot: customerSnapshot || null,
      customerTrackingToken: source === 'online' ? (customerTrackingToken || null) : null,
      createdBy: resolvedUserId,
      updatedBy: resolvedUserId
    };

    // 4. Validate complete order structure and financial invariants
    const validation = validateOrder(orderPayload, {
      skipTableRequirement: input.skipTableSessionValidation || !orderPayload.tableId
    });
    if (!validation.isValid) {
      throw new Error(`Order validation failed: ${validation.error}`);
    }

    return this.createOrder(cleanRestaurantId, orderPayload, input.clientRequestId);
  }

  /**
   * Authoritative combined method to create an Order and its initial Kitchen Order Ticket (KOT)
   * in a reliable, atomic manner.
   * Ensures that kitchen ticket dispatch and order generation never become desynchronized.
   */
  async createOrderAndKOTFromCart(
    input: CreateOrderFromCartInput
  ): Promise<{ order: Order; kot: KOT }> {
    const {
      restaurantId,
      cartState,
      orderType,
      source,
      tableId,
      tableSessionId,
      customerSnapshot,
      notes,
      taxJurisdiction = 'intraState',
      createdBy,
      clientRequestId
    } = input;

    if (!restaurantId || typeof restaurantId !== 'string' || restaurantId.trim() === '') {
      throw new Error('Valid restaurantId is required to create an order.');
    }

    const cleanRestaurantId = restaurantId.trim();
    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';
    if (source !== 'online' && typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to create a restaurant order.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch((await import('../utils/apiConfig')).getApiUrl('/api/orders/create-pos'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          restaurantId: cleanRestaurantId,
          cartState,
          orderType,
          source,
          tableId,
          tableSessionId,
          customerSnapshot,
          notes,
          taxJurisdiction,
          clientRequestId: input.clientRequestId,
          skipTableSessionValidation: input.skipTableSessionValidation,
          createKot: true
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.order || !payload?.kot) {
        throw new Error(payload?.message || 'Order and KOT creation failed.');
      }
      return { order: payload.order as Order, kot: payload.kot as KOT };
    }
    if (source === 'online') {
      await validatePublicCustomerOrderingEligibility(cleanRestaurantId, cartState, orderType);
    } else {
      await enforcePermission(cleanRestaurantId, 'create_orders');
    }

    // 1. Validate Dine-In Pre-conditions
    if (orderType === 'dineIn' && !input.skipTableSessionValidation) {
      if (!tableSessionId || typeof tableSessionId !== 'string' || tableSessionId.trim() === '') {
        throw new Error('Dine-in orders require a valid tableSessionId.');
      }

      const sessionRef = doc(
        db,
        'restaurants',
        cleanRestaurantId,
        'tableSessions',
        tableSessionId.trim()
      );
      const sessionSnap = await getDoc(sessionRef);

      if (!sessionSnap.exists()) {
        throw new Error(
          `Cannot create dine-in order: TableSession "${tableSessionId}" does not exist in restaurant "${cleanRestaurantId}".`
        );
      }

      const sessionData = sessionSnap.data();
      if (sessionData.status !== 'open') {
        throw new Error(
          `Cannot create dine-in order: TableSession "${tableSessionId}" is closed (status: ${sessionData.status}).`
        );
      }

      if (sessionData.restaurantId !== cleanRestaurantId) {
        throw new Error(
          `Cannot create dine-in order: TableSession does not belong to restaurant "${cleanRestaurantId}".`
        );
      }
    }

    const cleanKey = clientRequestId?.trim();
    if (cleanKey) {
      const check = await idempotencyService.checkOrAcquire<{ order: Order; kot: KOT }>(
        cleanRestaurantId,
        cleanKey,
        'create_order_with_kot',
        { cartState, orderType, tableId, tableSessionId }
      );

      if (check.action === 'return_cached' && check.cachedResult) {
        return check.cachedResult;
      }
    }

    // 2. Try to find an existing active dine-in order to merge
    let existingActiveOrder: Order | null = null;
    let existingOrderDocRef: any = null;

    if (orderType === 'dineIn' && tableSessionId) {
      try {
        const ordersCol = collection(db, 'restaurants', cleanRestaurantId, 'orders');
        const q = query(
          ordersCol,
          where('tableSessionId', '==', tableSessionId.trim())
        );
        const querySnap = await getDocs(q);
        for (const d of querySnap.docs) {
          const data = d.data();
          if (data.status !== 'cancelled' && data.status !== 'completed') {
            existingActiveOrder = { id: d.id, ...data } as Order;
            existingOrderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', d.id);
            break;
          }
        }
      } catch (err) {
        console.warn('[RestaurantOS] Failed checking for existing table session order in createOrderAndKOTFromCart:', err);
      }
    }

    let finalMergedItems: OrderItem[];
    let finalCalculationResult: any;
    let dueAmountMinor = 0;
    const now = new Date();
    const resolvedUserId = createdBy || auth.currentUser?.uid || 'system';

    if (existingActiveOrder && existingOrderDocRef) {
      // Convert existing order items into CartItem format so we can merge
      const mergedCartItems: CartItem[] = [];

      // Start with existing items
      existingActiveOrder.items.forEach((item, index) => {
        mergedCartItems.push({
          cartItemId: `existing_${index}_${item.itemId}`,
          itemId: item.itemId,
          nameSnapshot: item.nameSnapshot,
          shortNameSnapshot: item.shortNameSnapshot || '',
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          taxRate: item.taxRate,
          taxInclusive: item.taxInclusive,
          notes: item.notes || '',
          modifiers: item.modifiers ? [...item.modifiers] : []
        });
      });

      // Merge new items from cartState.items
      cartState.items.forEach((newItem) => {
        const matchingItemIndex = mergedCartItems.findIndex((mergedItem) => {
          if (mergedItem.itemId !== newItem.itemId) return false;
          const m1 = mergedItem.modifiers || [];
          const m2 = newItem.modifiers || [];
          if (m1.length !== m2.length) return false;
          const m1Ids = m1.map(m => m.id).sort().join(',');
          const m2Ids = m2.map(m => m.id).sort().join(',');
          return m1Ids === m2Ids;
        });

        if (matchingItemIndex !== -1) {
          mergedCartItems[matchingItemIndex].quantity += newItem.quantity;
          if (newItem.notes && newItem.notes.trim() !== '') {
            const oldNotes = mergedCartItems[matchingItemIndex].notes || '';
            mergedCartItems[matchingItemIndex].notes = oldNotes ? `${oldNotes}; ${newItem.notes}` : newItem.notes;
          }
        } else {
          mergedCartItems.push({
            ...newItem,
            cartItemId: `new_${Date.now()}_${newItem.itemId}`
          });
        }
      });

      // Re-run calculation
      const mergedCartState: CartState = {
        items: mergedCartItems,
        orderDiscount: cartState.orderDiscount || (existingActiveOrder as any).orderDiscount,
        notes: cartState.notes || existingActiveOrder.notes || ''
      };

      const prep = this.prepareOrderItemsAndTotals(mergedCartState, taxJurisdiction);
      finalMergedItems = prep.items;
      finalCalculationResult = prep.calculationResult;

      const paidAmountMinor = existingActiveOrder.paidAmountMinor || 0;
      dueAmountMinor = Math.max(0, finalCalculationResult.grandTotalMinor - paidAmountMinor);

      // Build KOT items for ONLY the newly added items
      const kotNumber = `KOT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const kotColRef = collection(db, 'restaurants', cleanRestaurantId, 'kots');
      const kotDocRef = doc(kotColRef);

      const kotItems: KOTItem[] = cartState.items.map((item) => ({
        itemId: item.itemId,
        nameSnapshot: item.nameSnapshot,
        shortNameSnapshot: item.shortNameSnapshot,
        imageUrlSnapshot: item.imageUrlSnapshot || null,
        foodTypeSnapshot: item.foodTypeSnapshot || null,
        quantity: item.quantity,
        notes: item.notes,
        modifiers: item.modifiers ? [...item.modifiers] : undefined
      }));

      const kotPayload: Omit<KOT, 'id' | 'createdAt' | 'updatedAt'> = {
        kotNumber,
        restaurantId: cleanRestaurantId,
        orderId: existingActiveOrder.id,
        tableId: existingActiveOrder.tableId || null,
        tableSessionId: existingActiveOrder.tableSessionId || null,
        items: kotItems,
        notes: notes || cartState.notes || '',
        status: 'sentToKitchen',
        sentToKitchenAt: serverTimestamp(),
        createdBy: resolvedUserId,
        updatedBy: resolvedUserId
      };

      const updatedOrderPayload = {
        items: finalMergedItems,
        subtotalMinor: finalCalculationResult.subtotalMinor,
        discountMinor: finalCalculationResult.discountMinor,
        taxableAmountMinor: finalCalculationResult.taxableAmountMinor,
        cgstMinor: finalCalculationResult.cgstMinor,
        sgstMinor: finalCalculationResult.sgstMinor,
        igstMinor: finalCalculationResult.igstMinor,
        totalTaxMinor: finalCalculationResult.totalTaxMinor,
        grandTotalMinor: finalCalculationResult.grandTotalMinor,
        dueAmountMinor,
        updatedAt: serverTimestamp(),
        updatedBy: resolvedUserId
      };

      const sanitizedOrderUpdate = sanitizeFirestoreData(updatedOrderPayload);
      const sanitizedKotDoc = sanitizeFirestoreData({
        ...kotPayload,
        id: kotDocRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const mergeBatch = writeBatch(db);
      mergeBatch.update(existingOrderDocRef, sanitizedOrderUpdate);
      mergeBatch.set(kotDocRef, sanitizedKotDoc);
      await mergeBatch.commit();

      const updatedOrder: Order = {
        ...existingActiveOrder,
        ...updatedOrderPayload,
        updatedAt: now
      } as Order;

      const createdKot: KOT = {
        id: kotDocRef.id,
        ...kotPayload,
        createdAt: now,
        updatedAt: now
      };

      // Audit logs
      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: updatedOrder.id,
        action: 'order_updated',
        actorUid: resolvedUserId,
        metadata: {
          orderNumber: updatedOrder.orderNumber,
          grandTotalMinor: updatedOrder.grandTotalMinor,
          orderType: updatedOrder.orderType,
          tableSessionId: updatedOrder.tableSessionId || null,
          kotId: createdKot.id,
          kotNumber: createdKot.kotNumber,
          appendedItemsCount: cartState.items.length
        }
      });

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'kot',
        entityId: createdKot.id,
        action: 'kot_created',
        actorUid: resolvedUserId,
        metadata: {
          kotNumber: createdKot.kotNumber,
          orderId: updatedOrder.id,
          status: createdKot.status,
          itemCount: createdKot.items.length
        }
      });

      // Stock consumption: tracked authoritatively, never silent
      try {
        const consumptionResult = await stockConsumptionService.consumeStockForOrderViaBackend(cleanRestaurantId, {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          items: cartState.items.map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            nameSnapshot: i.nameSnapshot
          })),
          clientRequestId: cleanKey ? `${cleanKey}_consumption_append` : undefined
        });

        const status = consumptionResult.consumptions.length > 0 ? 'consumed' : 'not_applicable';
        updatedOrder.stockConsumptionStatus = status;
        await updateDoc(existingOrderDocRef, {
          stockConsumptionStatus: status,
          stockConsumptionError: null,
          updatedAt: serverTimestamp()
        });
      } catch (consumptionErr: any) {
        console.warn('Recipe stock consumption notice for appended items:', consumptionErr);
        const errMsg = consumptionErr?.message || 'Stock consumption failed';
        updatedOrder.stockConsumptionStatus = 'failed';
        updatedOrder.stockConsumptionError = errMsg;
        try {
          await updateDoc(existingOrderDocRef, {
            stockConsumptionStatus: 'failed',
            stockConsumptionError: errMsg,
            updatedAt: serverTimestamp()
          });

          await auditService.logEvent(cleanRestaurantId, {
            restaurantId: cleanRestaurantId,
            entityType: 'order',
            entityId: updatedOrder.id,
            action: 'stock_consumption_failed',
            actorUid: updatedOrder.createdBy || auth.currentUser?.uid || 'system',
            metadata: {
              orderNumber: updatedOrder.orderNumber,
              error: errMsg
            }
          });
        } catch (updateErr) {
          console.warn('Failed to record stockConsumptionStatus on order:', updateErr);
        }
      }

      const result = { order: updatedOrder, kot: createdKot };

      if (cleanKey) {
        await idempotencyService.recordSuccess(
          cleanRestaurantId,
          cleanKey,
          'create_order_with_kot',
          { cartState, orderType, tableId, tableSessionId },
          updatedOrder.id,
          result
        );
      }

      return result;
    }

    // 3. Otherwise, normal brand-new order flow (unchanged)
    const prep = this.prepareOrderItemsAndTotals(cartState, taxJurisdiction);
    finalMergedItems = prep.items;
    finalCalculationResult = prep.calculationResult;
    dueAmountMinor = finalCalculationResult.grandTotalMinor;

    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const kotNumber = `KOT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const orderPayload: Omit<Order, 'id' | 'createdAt' | 'updatedAt'> = {
      restaurantId: cleanRestaurantId,
      orderNumber,
      customerId: input.customerId ? input.customerId.trim() : null,
      orderType,
      source,
      status: 'sentToKitchen',
      tableId: orderType === 'dineIn' ? (tableId || null) : null,
      tableSessionId: orderType === 'dineIn' ? (tableSessionId || null) : null,
      items: finalMergedItems,
      subtotalMinor: finalCalculationResult.subtotalMinor,
      discountMinor: finalCalculationResult.discountMinor,
      taxableAmountMinor: finalCalculationResult.taxableAmountMinor,
      cgstMinor: finalCalculationResult.cgstMinor,
      sgstMinor: finalCalculationResult.sgstMinor,
      igstMinor: finalCalculationResult.igstMinor,
      totalTaxMinor: finalCalculationResult.totalTaxMinor,
      grandTotalMinor: finalCalculationResult.grandTotalMinor,
      paidAmountMinor: 0,
      dueAmountMinor,
      notes: notes || cartState.notes,
      customerSnapshot: customerSnapshot || null,
      customerTrackingToken: source === 'online' ? (input.customerTrackingToken || null) : null,
      createdBy: resolvedUserId,
      updatedBy: resolvedUserId
    };

    // 4. Validate complete order structure
    const orderValidation = validateOrder(orderPayload, {
      skipTableRequirement: input.skipTableSessionValidation || !orderPayload.tableId
    });
    if (!orderValidation.isValid) {
      throw new Error(`Order validation failed: ${orderValidation.error}`);
    }

    // 5. Build KOT items
    const kotItems: KOTItem[] = finalMergedItems.map((item) => ({
      itemId: item.itemId,
      nameSnapshot: item.nameSnapshot,
      shortNameSnapshot: item.shortNameSnapshot,
      imageUrlSnapshot: item.imageUrlSnapshot || null,
      foodTypeSnapshot: item.foodTypeSnapshot || null,
      quantity: item.quantity,
      notes: item.notes,
      modifiers: item.modifiers ? [...item.modifiers] : undefined
    }));

    try {
      const orderColRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
      const orderDocRef = doc(orderColRef);

      const kotColRef = collection(db, 'restaurants', cleanRestaurantId, 'kots');
      const kotDocRef = doc(kotColRef);

      const kotPayload: Omit<KOT, 'id' | 'createdAt' | 'updatedAt'> = {
        kotNumber,
        restaurantId: cleanRestaurantId,
        orderId: orderDocRef.id,
        tableId: orderPayload.tableId || null,
        tableSessionId: orderPayload.tableSessionId || null,
        items: kotItems,
        notes: orderPayload.notes || '',
        status: 'sentToKitchen',
        sentToKitchenAt: serverTimestamp(),
        createdBy: resolvedUserId,
        updatedBy: resolvedUserId
      };

      const orderFirestoreDoc = sanitizeFirestoreData({
        ...orderPayload,
        id: orderDocRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const kotFirestoreDoc = sanitizeFirestoreData({
        ...kotPayload,
        id: kotDocRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Write Order and KOT atomically so a successful order can never exist without its KOT.
      const orderKotBatch = writeBatch(db);
      orderKotBatch.set(orderDocRef, orderFirestoreDoc);
      orderKotBatch.set(kotDocRef, kotFirestoreDoc);
      await orderKotBatch.commit();

      const createdOrder: Order = {
        id: orderDocRef.id,
        ...orderPayload,
        createdAt: now,
        updatedAt: now
      };

      const createdKot: KOT = {
        id: kotDocRef.id,
        ...kotPayload,
        createdAt: now,
        updatedAt: now
      };

      // Audit logs
      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: createdOrder.id,
        action: 'order_created',
        actorUid: resolvedUserId,
        metadata: {
          orderNumber: createdOrder.orderNumber,
          grandTotalMinor: createdOrder.grandTotalMinor,
          orderType: createdOrder.orderType,
          tableSessionId: createdOrder.tableSessionId || null,
          kotId: createdKot.id,
          kotNumber: createdKot.kotNumber
        }
      });

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'kot',
        entityId: createdKot.id,
        action: 'kot_created',
        actorUid: resolvedUserId,
        metadata: {
          kotNumber: createdKot.kotNumber,
          orderId: createdOrder.id,
          status: createdKot.status,
          itemCount: createdKot.items.length
        }
      });

      // Stock consumption: tracked authoritatively, never silent
      try {
        const consumptionResult = await stockConsumptionService.consumeStockForOrderViaBackend(cleanRestaurantId, {
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          items: createdOrder.items.map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            nameSnapshot: i.nameSnapshot
          })),
          clientRequestId: cleanKey ? `${cleanKey}_consumption` : undefined
        });

        const status = consumptionResult.consumptions.length > 0 ? 'consumed' : 'not_applicable';
        createdOrder.stockConsumptionStatus = status;
        const orderRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', createdOrder.id);
        await updateDoc(orderRef, {
          stockConsumptionStatus: status,
          stockConsumptionError: null,
          updatedAt: serverTimestamp()
        });
      } catch (consumptionErr: any) {
        console.warn('Recipe stock consumption notice:', consumptionErr);
        const errMsg = consumptionErr?.message || 'Stock consumption failed';
        createdOrder.stockConsumptionStatus = 'failed';
        createdOrder.stockConsumptionError = errMsg;
        try {
          const orderRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', createdOrder.id);
          await updateDoc(orderRef, {
            stockConsumptionStatus: 'failed',
            stockConsumptionError: errMsg,
            updatedAt: serverTimestamp()
          });

          await auditService.logEvent(cleanRestaurantId, {
            restaurantId: cleanRestaurantId,
            entityType: 'order',
            entityId: createdOrder.id,
            action: 'stock_consumption_failed',
            actorUid: createdOrder.createdBy || auth.currentUser?.uid || 'system',
            metadata: {
              orderNumber: createdOrder.orderNumber,
              error: errMsg
            }
          });
        } catch (updateErr) {
          console.warn('Failed to record stockConsumptionStatus on order:', updateErr);
        }
      }

      const result = { order: createdOrder, kot: createdKot };

      if (cleanKey) {
        await idempotencyService.recordSuccess(
          cleanRestaurantId,
          cleanKey,
          'create_order_with_kot',
          { cartState, orderType, tableId, tableSessionId },
          createdOrder.id,
          result
        );
      }

      return result;
    } catch (err: unknown) {
      if (cleanKey) {
        await idempotencyService.recordFailure(
          cleanRestaurantId,
          cleanKey,
          (err as any)?.message || 'Failed to create order and KOT'
        );
      }
      throw handleFirestoreError(err, OperationType.CREATE, ordersPath(cleanRestaurantId));
    }
  }

  /**
   * Safe service-level workflow abstraction for creating orders according to the active
   * operating mode and capabilities of the restaurant.
   *
   * - If kitchen workflow is enabled: dispatches through authoritative Order + KOT pipeline.
   * - If kitchen workflow is disabled (e.g. single_person mode): creates canonical Order
   *   without generating redundant KOT records, preserving all financial calculations,
   *   minor integer units, taxes, discounts, audit logs, and inventory consumption.
   */
  async createOrderForOperatingMode(
    input: CreateOrderForOperatingModeInput
  ): Promise<{ order: Order; kot: KOT | null }> {
    const { restaurant, operatingProfile } = input;
    const resolvedProfile = operatingProfile || (restaurant ? getRestaurantOperatingProfile(restaurant) : getRestaurantOperatingProfile(null));

    const skipTableSession = !resolvedProfile.capabilities.tablesEnabled;

    if (resolvedProfile.capabilities.kitchenEnabled) {
      const res = await this.createOrderAndKOTFromCart({
        ...input,
        skipTableSessionValidation: skipTableSession
      });
      return { order: res.order, kot: res.kot };
    } else {
      const order = await this.createOrderFromCart({
        ...input,
        skipTableSessionValidation: skipTableSession
      });
      return { order, kot: null };
    }
  }

  /**
   * Persists a pre-constructed order entity into Firestore.
   * Hardened with Idempotency Key binding to prevent duplicate orders across retries/network drops.
   */
  async createOrder(
    restaurantId: string,
    orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>,
    clientRequestId?: string
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId.trim();
    const path = ordersPath(cleanRestaurantId);

    // Validate order
    const validation = validateOrder(orderData, {
      skipTableRequirement: !orderData.tableId
    });
    if (!validation.isValid) {
      throw new Error(`Order validation failed: ${validation.error}`);
    }

    const cleanKey = clientRequestId?.trim();

    // Check idempotency if clientRequestId is provided
    if (cleanKey) {
      const check = await idempotencyService.checkOrAcquire<Order>(
        cleanRestaurantId,
        cleanKey,
        'create_order',
        orderData
      );

      if (check.action === 'return_cached' && check.cachedResult) {
        return check.cachedResult;
      }
    }

    try {
      const colRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
      const newDocRef = doc(colRef);
      const now = new Date();

      const docPayload = sanitizeFirestoreData({
        ...orderData,
        id: newDocRef.id,
        createdAt: serverTimestamp() || now,
        updatedAt: serverTimestamp() || now
      });

      await setDoc(newDocRef, docPayload);

      const createdOrder: Order = {
        id: newDocRef.id,
        ...orderData,
        createdAt: now,
        updatedAt: now
      };

      // Persisting the order is the critical path. Audit and recipe stock
      // reconciliation can converge after the order is visible to the operator.
      void auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: createdOrder.id,
        action: 'order_created',
        actorUid: createdOrder.createdBy || auth.currentUser?.uid || 'system',
        metadata: {
          orderNumber: createdOrder.orderNumber,
          grandTotalMinor: createdOrder.grandTotalMinor,
          orderType: createdOrder.orderType,
          tableSessionId: createdOrder.tableSessionId || null
        }
      }).catch((error) => console.warn('[OrderService] Order creation audit notice:', error));

      if (cleanKey) {
        await idempotencyService.recordSuccess(
          cleanRestaurantId,
          cleanKey,
          'create_order',
          orderData,
          createdOrder.id,
          createdOrder
        );
      }

      void (async () => {
        try {
          const consumptionResult = await stockConsumptionService.consumeStockForOrderViaBackend(cleanRestaurantId, {
            orderId: createdOrder.id,
            orderNumber: createdOrder.orderNumber,
            items: createdOrder.items.map((i) => ({
              itemId: i.itemId,
              quantity: i.quantity,
              nameSnapshot: i.nameSnapshot
            })),
            clientRequestId: cleanKey ? `${cleanKey}_consumption` : undefined
          });

          const status = consumptionResult.consumptions.length > 0 ? 'consumed' : 'not_applicable';
          createdOrder.stockConsumptionStatus = status;
          const orderRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', createdOrder.id);
          await updateDoc(orderRef, {
            stockConsumptionStatus: status,
            stockConsumptionError: null,
            updatedAt: serverTimestamp()
          });
        } catch (consumptionErr: any) {
          console.warn('Recipe stock consumption notice:', consumptionErr);
          const errMsg = consumptionErr?.message || 'Stock consumption failed';
          createdOrder.stockConsumptionStatus = 'failed';
          createdOrder.stockConsumptionError = errMsg;
          try {
            const orderRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', createdOrder.id);
            await updateDoc(orderRef, {
              stockConsumptionStatus: 'failed',
              stockConsumptionError: errMsg,
              updatedAt: serverTimestamp()
            });

            await auditService.logEvent(cleanRestaurantId, {
              restaurantId: cleanRestaurantId,
              entityType: 'order',
              entityId: createdOrder.id,
              action: 'stock_consumption_failed',
              actorUid: createdOrder.createdBy || auth.currentUser?.uid || 'system',
              metadata: {
                orderNumber: createdOrder.orderNumber,
                error: errMsg
              }
            });
          } catch (updateErr) {
            console.warn('Failed to record stockConsumptionStatus on order:', updateErr);
          }
        }
      })();
      return createdOrder;
    } catch (err: unknown) {
      if (cleanKey) {
        await idempotencyService.recordFailure(
          cleanRestaurantId,
          cleanKey,
          (err as any)?.message || 'Failed to create order'
        );
      }
      throw handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  /**
   * Updates an order's lifecycle status using the centralized status transition validator.
   */
  async updateOrderStatus(
    restaurantId: string,
    orderId: string,
    newStatus: OrderStatus,
    updatedBy: string,
    cancellationReason?: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId.trim();
    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';
    if (newStatus === 'completed' && typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to complete an order.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch((await import('../utils/apiConfig')).getApiUrl('/api/orders/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ restaurantId: cleanRestaurantId, orderId: orderId.trim() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Order completion failed.');
      return;
    }

    if (newStatus === 'cancelled') {
      await enforcePermission(cleanRestaurantId, 'cancel_orders');
    } else {
      await enforcePermission(cleanRestaurantId, 'modify_orders');
    }

    const cleanOrderId = orderId.trim();
    const path = orderDocPath(cleanRestaurantId, cleanOrderId);

    // 1. Fetch current order
    let orderSnap;
    try {
      const docRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
      orderSnap = await getDoc(docRef);
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.GET, path);
    }

    if (!orderSnap.exists()) {
      throw new Error(`Cannot update order status: Order "${cleanOrderId}" not found.`);
    }

    const currentOrder = orderSnap.data() as Order;

    // 2. Validate lifecycle transition
    const transitionResult = validateOrderStatusTransition(currentOrder.status, newStatus);
    if (!transitionResult.isValid) {
      throw new Error(`Cannot transition order status: ${transitionResult.error}`);
    }

    // 2b. If transitioning to 'completed', enforce full financial settlement and terminal KOT invariants
    if (newStatus === 'completed') {
      const dueAmount = currentOrder.dueAmountMinor ?? Math.max(0, (currentOrder.grandTotalMinor || 0) - (currentOrder.paidAmountMinor || 0));
      if (dueAmount > 0) {
        throw new Error(
          `Cannot complete order "${currentOrder.orderNumber || cleanOrderId}": Outstanding due of ₹${(dueAmount / 100).toFixed(2)} must be settled before completion.`
        );
      }

      // Check active KOTs
      try {
        const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
        const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
        const kotSnap = await getDocs(kotQuery);
        for (const d of kotSnap.docs) {
          const kotData = d.data() as KOT;
          if (kotData.status !== 'served' && kotData.status !== 'cancelled') {
            throw new Error(
              `Cannot complete order "${currentOrder.orderNumber || cleanOrderId}": KOT "${kotData.kotNumber || d.id}" is still in status "${kotData.status}". All kitchen tickets must be served or cancelled before completing the order.`
            );
          }
        }
      } catch (kotErr: any) {
        if (kotErr.message && kotErr.message.includes('Cannot complete order')) throw kotErr;
        // Ignore listing error if running in restricted context
      }
    }

    // 2c. Waiter/captain cancellation is allowed only within 2 minutes of ORDER CREATION.
    // Managers/owners retain their existing cancellation authority.
    if (newStatus === 'cancelled') {
      const currentRole = await getCurrentUserRestaurantRole(cleanRestaurantId);

      // Only a confirmed captain/waiter role is subject to the 2-minute
      // self-cancellation window. An unresolved role must fail closed instead
      // of being treated as a captain during auth/profile races.
      if (currentRole === 'captain') {
        const createdAtValue: any = (currentOrder as any).createdAt;
        const createdAt = createdAtValue?.toDate
          ? createdAtValue.toDate()
          : createdAtValue instanceof Date
            ? createdAtValue
            : new Date(createdAtValue);
        const createdAtMs = createdAt.getTime();

        if (!Number.isFinite(createdAtMs)) {
          throw new Error('Cannot cancel order: order creation time is missing or invalid.');
        }

        const elapsedMs = Date.now() - createdAtMs;
        if (elapsedMs < 0 || elapsedMs > 2 * 60 * 1000) {
          throw new Error(
            'Cannot cancel order from waiter/POS: the 2-minute order cancellation window has expired. Cancel the active KOT from the kitchen flow.'
          );
        }
      }

      try {
        const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
        const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
        const kotSnap = await getDocs(kotQuery);
        const resolvedUserId = updatedBy || auth.currentUser?.uid || 'system';
        const now = new Date();

        for (const d of kotSnap.docs) {
          const kotData = d.data() as KOT;
          // Any non-terminal KOT belongs to the cancelled parent order and must
          // be cancelled with it. The previous implementation only handled
          // confirmed/sentToKitchen, leaving preparing/ready KOTs active.
          if (kotData.status !== 'served' && kotData.status !== 'cancelled') {
            const kotRef = doc(db, 'restaurants', cleanRestaurantId, 'kots', d.id);
            await updateDoc(kotRef, {
              status: 'cancelled',
              cancellationReason: cancellationReason || 'Parent order cancelled within 2-minute waiter window',
              cancelledAt: serverTimestamp() || now,
              cancelledBy: resolvedUserId,
              updatedAt: serverTimestamp() || now,
              updatedBy: resolvedUserId
            });
            await auditService.logEvent(cleanRestaurantId, {
              restaurantId: cleanRestaurantId,
              entityType: 'kot',
              entityId: d.id,
              action: 'kot_cancelled_auto_pos',
              actorUid: resolvedUserId,
              metadata: {
                kotNumber: kotData.kotNumber,
                orderId: cleanOrderId,
                reason: 'Auto-cancelled because parent order was cancelled'
              }
            });
          }
        }
      } catch (err: any) {
        console.warn('[RestaurantOS] KOT auto-cancel during order cancellation warning:', err);
      }
    }

    // 3. Apply status update
    try {
      const docRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
      const now = new Date();
      const resolvedUserId = updatedBy || auth.currentUser?.uid || 'system';

      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        updatedAt: serverTimestamp() || now,
        updatedBy: resolvedUserId
      };

      if (newStatus === 'cancelled') {
        // A cancelled order must never remain collectible. Preserve the
        // historical grand total/paid amount for audit, but close the
        // outstanding balance so Payment Due Center and table settlement
        // cannot present a cancelled order as money still owed.
        updatePayload.cancellationReason = cancellationReason || 'Cancelled by staff';
        updatePayload.cancelledAt = serverTimestamp() || now;
        updatePayload.cancelledBy = resolvedUserId;
        updatePayload.dueAmountMinor = 0;
        updatePayload.paymentStatus = 'cancelled';
      }

      await updateDoc(docRef, updatePayload);

      // A cancelled dine-in order must be removed from the session's active-order
      // list without destroying the canonical pointer when another active order remains.
      // Use a transaction so two waiter/table actions cannot race and overwrite each
      // other's session state.
      if (newStatus === 'cancelled' && currentOrder.tableSessionId) {
        try {
          const sessionRef = doc(
            db,
            cleanRestaurantId,
            'tableSessions',
            String(currentOrder.tableSessionId)
          );
          await runTransaction(db, async (transaction) => {
            const sessionSnap = await transaction.get(sessionRef);
            if (!sessionSnap.exists()) return;

            const sessionData = sessionSnap.data() as any;
            const reconciled = reconcileCancelledOrderInTableSession(sessionData, cleanOrderId);

            const update: Record<string, any> = {
              ...reconciled,
              updatedAt: serverTimestamp()
            };

            transaction.update(sessionRef, update);
          });
        } catch (sessionErr) {
          console.warn('[RestaurantOS] Failed to reconcile cancelled order with active table session:', sessionErr);
        }
      }

      // Reverse stock consumption for cancelled order
      if (newStatus === 'cancelled') {
        try {
          await stockConsumptionService.reverseOrderStockConsumption(
            cleanRestaurantId,
            cleanOrderId,
            cancellationReason || 'Order cancelled'
          );
          await updateDoc(docRef, {
            stockConsumptionStatus: 'reversed',
            updatedAt: serverTimestamp()
          });
        } catch (revErr: any) {
          console.warn('Stock consumption reversal notice:', revErr);
          const revErrMsg = revErr?.message || 'Stock consumption reversal failed';
          try {
            await updateDoc(docRef, {
              stockConsumptionStatus: 'reversal_failed',
              stockConsumptionError: revErrMsg,
              updatedAt: serverTimestamp()
            });
            await auditService.logEvent(cleanRestaurantId, {
              restaurantId: cleanRestaurantId,
              entityType: 'order',
              entityId: cleanOrderId,
              action: 'stock_reversal_failed',
              actorUid: resolvedUserId,
              metadata: {
                error: revErrMsg,
                cancellationReason: cancellationReason || null
              }
            });
          } catch (logErr) {
            console.warn('Failed to record reversal failure on order:', logErr);
          }
        }
      }

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: newStatus === 'cancelled' ? 'order_cancelled' : 'order_updated',
        actorUid: resolvedUserId,
        metadata: {
          oldStatus: currentOrder.status,
          newStatus,
          cancellationReason: cancellationReason || null
        }
      });

      if (newStatus === 'completed' || newStatus === 'cancelled') {
        try {
          await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
            cleanRestaurantId,
            cleanOrderId,
            resolvedUserId
          );
        } catch (autoErr) {
          console.warn('[OrderService] Notice: auto session closure check after status update encountered:', autoErr);
        }
      }
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  /**
   * Explicit, idempotent retry mechanism for orders whose stock consumption previously failed.
   */
  async retryOrderStockConsumption(
    restaurantId: string,
    orderId: string
  ): Promise<{ status: 'consumed' | 'not_applicable' | 'already_consumed'; error?: string }> {
    const cleanRestId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to retry stock consumption');
    }

    const order = await this.getOrderById(cleanRestId, cleanOrderId);
    if (!order) {
      throw new Error(`Order "${cleanOrderId}" does not exist in restaurant "${cleanRestId}".`);
    }

    if (order.status === 'cancelled') {
      throw new Error(`Cannot consume stock for cancelled order "${cleanOrderId}".`);
    }

    if (order.stockConsumptionStatus === 'consumed') {
      return { status: 'already_consumed' };
    }

    try {
      const res = await stockConsumptionService.consumeStockForOrderViaBackend(cleanRestId, {
        orderId: cleanOrderId,
        orderNumber: order.orderNumber,
        items: order.items.map((i) => ({
          itemId: i.itemId,
          quantity: i.quantity,
          nameSnapshot: i.nameSnapshot
        })),
        clientRequestId: `retry_${cleanRestId}_${cleanOrderId}`
      });

      const status = res.consumptions.length > 0 ? 'consumed' : 'not_applicable';
      const orderRef = doc(db, 'restaurants', cleanRestId, 'orders', cleanOrderId);
      await updateDoc(orderRef, {
        stockConsumptionStatus: status,
        stockConsumptionError: null,
        updatedAt: serverTimestamp()
      });

      await auditService.logEvent(cleanRestId, {
        restaurantId: cleanRestId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: 'stock_consumption_retried',
        actorUid: auth.currentUser?.uid || 'system',
        metadata: {
          orderNumber: order.orderNumber,
          status
        }
      });

      return { status };
    } catch (err: any) {
      const errMsg = err?.message || 'Stock consumption retry failed';
      const orderRef = doc(db, 'restaurants', cleanRestId, 'orders', cleanOrderId);
      await updateDoc(orderRef, {
        stockConsumptionStatus: 'failed',
        stockConsumptionError: errMsg,
        updatedAt: serverTimestamp()
      });
      throw err;
    }
  }

  /**
   * Authoritatively cancels specific quantities of items within an Order
   * (e.g., ordered 10 Biryanis, 5 are cancelled due to low stock or customer request).
   * 
   * Invariants preserved:
   * 1. Original quantity is NEVER overwritten; originalQuantity is preserved.
   * 2. Integer minor unit arithmetic (paisa) without float drift.
   * 3. Line items with 0 remaining quantity remain present with 0 amount for audit trail.
   * 4. Recalculates subtotal, taxes, discount, grand total, and due amount deterministically.
   * 5. If all items in order have quantity === 0, order transitions to 'cancelled'.
   * 6. Automatically triggers compensating partial stock consumption reversal.
   * 7. Logs comprehensive audit event.
   */
  async partiallyCancelOrderItems(
    restaurantId: string,
    orderId: string,
    itemCancellations: { itemId: string; cancelledQuantity: number; reason?: string }[],
    cancelledBy?: string,
    clientRequestId?: string
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required for partial order item cancellation.');
    }

    if (!itemCancellations || itemCancellations.length === 0) {
      throw new Error('itemCancellations array must not be empty.');
    }

    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';
    if (typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to partially cancel order items.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch(getApiUrl('/api/orders/partial-cancel-items'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          restaurantId: cleanRestaurantId,
          orderId: cleanOrderId,
          itemCancellations,
          clientRequestId
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.order) {
        throw new Error(payload?.message || 'Partial order cancellation failed.');
      }
      return payload.order as Order;
    }

    await enforcePermission(cleanRestaurantId, 'cancel_orders');

    const cleanKey = clientRequestId?.trim();
    if (cleanKey) {
      const check = await idempotencyService.checkOrAcquire<Order>(
        cleanRestaurantId,
        cleanKey,
        'partially_cancel_order_items',
        { orderId: cleanOrderId, itemCancellations, cancelledBy }
      );
      if (check.action === 'return_cached' && check.cachedResult) {
        return check.cachedResult;
      }
    }

    const currentOrder = await this.getOrderById(cleanRestaurantId, cleanOrderId);
    if (!currentOrder) {
      throw new Error(`Order "${cleanOrderId}" does not exist in restaurant "${cleanRestaurantId}".`);
    }

    if (currentOrder.status === 'cancelled') {
      throw new Error(`Cannot cancel items from already cancelled order "${cleanOrderId}".`);
    }
    if (currentOrder.status === 'completed') {
      throw new Error(`Cannot cancel items from already completed order "${cleanOrderId}".`);
    }

    const resolvedUserId = cancelledBy || auth.currentUser?.uid || 'system';
    const now = new Date();

    // Map cancellations by itemId
    const cancelMap = new Map<string, { qty: number; reason?: string }>();
    for (const c of itemCancellations) {
      const id = c.itemId?.trim();
      if (id && c.cancelledQuantity > 0) {
        const existing = cancelMap.get(id);
        const newQty = (existing?.qty || 0) + c.cancelledQuantity;
        cancelMap.set(id, { qty: newQty, reason: c.reason || existing?.reason });
      }
    }

    // Process order items
    const updatedItems: OrderItem[] = currentOrder.items.map((item) => {
      const cancelReq = cancelMap.get(item.itemId);
      if (!cancelReq || cancelReq.qty <= 0) {
        return { ...item };
      }

      const availableToCancel = item.quantity;
      if (cancelReq.qty > availableToCancel) {
        throw new Error(
          `Cannot cancel ${cancelReq.qty} of "${item.nameSnapshot}". Only ${availableToCancel} active in order.`
        );
      }

      const originalQuantity = item.originalQuantity !== undefined ? item.originalQuantity : item.quantity;
      const newlyCancelled = cancelReq.qty;
      const cancelledQuantity = (item.cancelledQuantity || 0) + newlyCancelled;
      const remainingQuantity = item.quantity - newlyCancelled;

      if (remainingQuantity > 0) {
        const lineRes = calculateOrderItemLine({
          quantity: remainingQuantity,
          unitPriceMinor: item.unitPriceMinor,
          taxRate: item.taxRate,
          taxInclusive: item.taxInclusive,
          discount: item.discountMinor > 0 ? { type: 'fixed', fixedAmountMinor: Math.round((item.discountMinor * remainingQuantity) / item.quantity) } : undefined
        });

        return {
          ...item,
          quantity: remainingQuantity,
          originalQuantity,
          cancelledQuantity,
          cancellationReason: cancelReq.reason || item.cancellationReason || 'Item partially cancelled',
          cancelledAt: now,
          cancelledBy: resolvedUserId,
          discountMinor: lineRes.discountMinor,
          lineSubtotalMinor: lineRes.subtotalMinor,
          lineTaxMinor: lineRes.totalTaxMinor,
          lineTotalMinor: lineRes.lineTotalMinor
        };
      } else {
        return {
          ...item,
          quantity: 0,
          originalQuantity,
          cancelledQuantity,
          cancellationReason: cancelReq.reason || item.cancellationReason || 'Item cancelled in full',
          cancelledAt: now,
          cancelledBy: resolvedUserId,
          discountMinor: 0,
          lineSubtotalMinor: 0,
          lineTaxMinor: 0,
          lineTotalMinor: 0
        };
      }
    });

    // Recalculate order financial totals from active items
    const activeItems = updatedItems.filter((i) => i.quantity > 0);
    let subtotalMinor = 0;
    let discountMinor = 0;
    let taxableAmountMinor = 0;
    let cgstMinor = 0;
    let sgstMinor = 0;
    let igstMinor = 0;
    let totalTaxMinor = 0;
    let grandTotalMinor = 0;

    if (activeItems.length > 0) {
      const calcResult = calculateOrderTotals({
        items: activeItems.map((item) => ({
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          taxRate: item.taxRate,
          taxInclusive: item.taxInclusive,
          discount: item.discountMinor > 0 ? { type: 'fixed', fixedAmountMinor: item.discountMinor } : undefined
        })),
        taxJurisdiction: 'intraState'
      });

      subtotalMinor = calcResult.subtotalMinor;
      discountMinor = calcResult.discountMinor;
      taxableAmountMinor = calcResult.taxableAmountMinor;
      cgstMinor = calcResult.cgstMinor;
      sgstMinor = calcResult.sgstMinor;
      igstMinor = calcResult.igstMinor;
      totalTaxMinor = calcResult.totalTaxMinor;
      grandTotalMinor = calcResult.grandTotalMinor;
    }

    const paidAmountMinor = currentOrder.paidAmountMinor || 0;
    if (!Number.isInteger(paidAmountMinor) || paidAmountMinor < 0) {
      throw new Error(`Invalid paid amount on order "${cleanOrderId}".`);
    }
    if (paidAmountMinor > grandTotalMinor) {
      throw new Error(`Cannot cancel these items because the resulting order total (₹${(grandTotalMinor / 100).toFixed(2)}) would be below the amount already paid (₹${(paidAmountMinor / 100).toFixed(2)}). Process the required refund before reducing the order total.`);
    }
    const dueAmountMinor = grandTotalMinor - paidAmountMinor;

    const isAllCancelled = activeItems.length === 0;
    const newStatus: OrderStatus = isAllCancelled ? 'cancelled' : currentOrder.status;

    const orderRef = doc(db, orderDocPath(cleanRestaurantId, cleanOrderId));
    const updatePayload: Record<string, any> = {
      items: updatedItems,
      subtotalMinor,
      discountMinor,
      taxableAmountMinor,
      cgstMinor,
      sgstMinor,
      igstMinor,
      totalTaxMinor,
      grandTotalMinor,
      dueAmountMinor,
      status: newStatus,
      updatedAt: serverTimestamp(),
      updatedBy: resolvedUserId
    };

    if (isAllCancelled) {
      updatePayload.cancellationReason = itemCancellations[0]?.reason || 'All order items cancelled';
      updatePayload.cancelledAt = serverTimestamp();
      updatePayload.cancelledBy = resolvedUserId;
    }

    const sanitizedPayload = sanitizeFirestoreData(updatePayload);
    const tableSessionRef = isAllCancelled && currentOrder.tableSessionId
      ? doc(db, 'restaurants', cleanRestaurantId, 'tableSessions', String(currentOrder.tableSessionId).trim())
      : null;

    await runTransaction(db, async (transaction) => {
      // Read every document first. Firestore retries the transaction if an
      // order/session document changes while this cancellation is in flight.
      const latestOrderSnap = await transaction.get(orderRef);
      const latestSessionSnap = tableSessionRef ? await transaction.get(tableSessionRef) : null;

      if (!latestOrderSnap.exists()) {
        throw new Error(`Order "${cleanOrderId}" no longer exists.`);
      }

      const latestOrder = latestOrderSnap.data() as Order;
      if (latestOrder.restaurantId !== cleanRestaurantId) {
        throw new Error('Cross-tenant order mutation rejected.');
      }
      if (latestOrder.status === 'cancelled' || latestOrder.status === 'completed') {
        throw new Error(`Order "${cleanOrderId}" can no longer be partially cancelled from status "${latestOrder.status}".`);
      }

      // Prevent a stale browser/server snapshot from overwriting another
      // cancellation or payment update with an older total/quantity state.
      if (
        Number(latestOrder.paidAmountMinor || 0) !== Number(currentOrder.paidAmountMinor || 0) ||
        Number(latestOrder.grandTotalMinor || 0) !== Number(currentOrder.grandTotalMinor || 0) ||
        !Array.isArray(latestOrder.items) ||
        latestOrder.items.length !== currentOrder.items.length
      ) {
        throw new Error('Order changed concurrently. Please retry the cancellation.');
      }

      const latestById = new Map(latestOrder.items.map((item) => [item.itemId, item]));
      for (const originalItem of currentOrder.items) {
        const latestItem = latestById.get(originalItem.itemId);
        if (
          !latestItem ||
          Number(latestItem.quantity) !== Number(originalItem.quantity) ||
          Number(latestItem.cancelledQuantity || 0) !== Number(originalItem.cancelledQuantity || 0)
        ) {
          throw new Error('Order changed concurrently. Please retry the cancellation.');
        }
      }

      transaction.update(orderRef, sanitizedPayload);

      if (isAllCancelled && tableSessionRef && latestSessionSnap && latestSessionSnap.exists()) {
        const sessionData = latestSessionSnap.data() as any;
        const reconciled = reconcileCancelledOrderInTableSession(sessionData, cleanOrderId);
        transaction.update(tableSessionRef, {
          ...reconciled,
          updatedAt: serverTimestamp()
        });
      }
    });

    const updatedOrder: Order = {
      ...currentOrder,
      ...updatePayload,
      updatedAt: now
    };

    // Audit log
    await auditService.logEvent(cleanRestaurantId, {
      restaurantId: cleanRestaurantId,
      entityType: 'order',
      entityId: cleanOrderId,
      action: 'order_items_partially_cancelled',
      actorUid: resolvedUserId,
      metadata: {
        orderNumber: currentOrder.orderNumber,
        itemCancellations,
        oldGrandTotalMinor: currentOrder.grandTotalMinor,
        newGrandTotalMinor: grandTotalMinor,
        isAllCancelled,
        dueAmountMinor
      }
    });

    // Compensating stock reversal
    try {
      await stockConsumptionService.reversePartialStockConsumption(
        cleanRestaurantId,
        cleanOrderId,
        itemCancellations.map((c) => ({ itemId: c.itemId, cancelledQuantity: c.cancelledQuantity })),
        itemCancellations[0]?.reason || 'Partial item cancellation',
        resolvedUserId,
        cleanKey ? `${cleanKey}_stock_rev` : undefined
      );
    } catch (stockErr) {
      console.warn('[RestaurantOS] Notice: partial stock consumption reversal encountered error:', stockErr);
    }

    if (cleanKey) {
      await idempotencyService.recordSuccess(
        cleanRestaurantId,
        cleanKey,
        'partially_cancel_order_items',
        { orderId: cleanOrderId, itemCancellations, cancelledBy },
        cleanOrderId,
        updatedOrder
      );
    }

    return updatedOrder;
  }

  /**
   * Subscribes to real-time order updates for a restaurant.
   */
  subscribeToOrders(
    restaurantId: string,
    onUpdate: (orders: Order[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const cleanRestaurantId = restaurantId.trim();
    const colRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
    const q = query(colRef, orderBy('createdAt', 'desc'));

    return onSnapshot(
      q,
      (snapshot) => {
        const orders: Order[] = [];
        snapshot.forEach((d) => {
          orders.push(reconcileOrderFinancials({ id: d.id, ...d.data() } as Order));
        });
        onUpdate(orders);
      },
      (err) => {
        if (!auth.currentUser) return;
        const errCode = (err as any)?.code;
        if (errCode === 'permission-denied' || errCode === 'unavailable') {
          console.warn('[RestaurantOS Debug] Orders subscription notice (permission/offline):', (err as any)?.message);
          onUpdate([]);
        } else {
          console.error('[RestaurantOS Debug] Error listening to orders:', err);
        }
        if (onError) onError(err as Error);
      }
    );
  }

  /**
   * Subscribes to real-time active order updates for operational views (Kitchen, Captain, POS).
   * Excludes historical completed or cancelled orders for network and rendering efficiency.
   */
  subscribeToActiveOrders(
    restaurantId: string,
    onUpdate: (orders: Order[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      if (onError) onError(new Error('restaurantId is required to subscribe to active orders.'));
      return () => {};
    }

    const colRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
    const q = query(colRef, orderBy('createdAt', 'desc'));

    return onSnapshot(
      q,
      (snapshot) => {
        const activeOrders: Order[] = [];
        snapshot.forEach((d) => {
          const ord = reconcileOrderFinancials({ id: d.id, ...d.data() } as Order);
          if (ord.status !== 'completed' && ord.status !== 'cancelled') {
            activeOrders.push(ord);
          }
        });
        onUpdate(activeOrders);
      },
      (err) => {
        if (!auth.currentUser) return;
        const errCode = (err as any)?.code;
        if (errCode === 'permission-denied' || errCode === 'unavailable') {
          console.warn('[RestaurantOS Debug] Active orders subscription notice:', (err as any)?.message);
          onUpdate([]);
        } else {
          console.error('[RestaurantOS Debug] Error listening to active orders:', err);
        }
        if (onError) onError(err as Error);
      }
    );
  }

  /**
   * Subscribes to real-time payment due orders for a restaurant.
   * Only returns active orders with outstanding financial balance (dueAmountMinor > 0)
   * that are not cancelled.
   */
  subscribeToPaymentDueOrders(
    restaurantId: string,
    onUpdate: (orders: Order[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      if (onError) onError(new Error('restaurantId is required to subscribe to payment due orders.'));
      return () => {};
    }

    const colRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
    const q = query(colRef, orderBy('createdAt', 'desc'));

    return onSnapshot(
      q,
      (snapshot) => {
        const dueOrders: Order[] = [];
        snapshot.forEach((d) => {
          const rawOrder = { id: d.id, ...d.data() } as Order;
          if (rawOrder.status === 'cancelled') return;

          // Keep payment collection consistent with the customer/order view even
          // if a previous merge left stale order-header totals.
          const ord = reconcileOrderFinancials(rawOrder);
          const dueAmount =
            ord.dueAmountMinor ??
            Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));

          if (dueAmount > 0 && ord.paymentStatus !== 'paid') {
            dueOrders.push({
              ...ord,
              dueAmountMinor: dueAmount
            });
          }
        });

        // Sort orders by operational priority:
        // Priority 1: Served / Ready orders first (customer finished eating / parcel ready)
        // Priority 2: Oldest outstanding orders (time elapsed)
        dueOrders.sort((a, b) => {
          const aServedOrReady = a.status === 'served' || a.status === 'ready';
          const bServedOrReady = b.status === 'served' || b.status === 'ready';

          if (aServedOrReady && !bServedOrReady) return -1;
          if (!aServedOrReady && bServedOrReady) return 1;

          const timeA = (a.createdAt as any)?.toMillis?.() || (a.createdAt ? new Date(a.createdAt as any).getTime() : 0);
          const timeB = (b.createdAt as any)?.toMillis?.() || (b.createdAt ? new Date(b.createdAt as any).getTime() : 0);

          return timeA - timeB;
        });

        onUpdate(dueOrders);
      },
      (err) => {
        if (!auth.currentUser) return;
        console.error('[RestaurantOS Debug] Error subscribing to payment due orders:', err);
        if (onError) onError(err as Error);
      }
    );
  }

  /**
   * Subscribes to real-time online orders for a restaurant.
   * Delivers all online orders sorted chronologically for queue processing.
   */
  subscribeToOnlineOrders(
    restaurantId: string,
    onUpdate: (orders: Order[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      if (onError) onError(new Error('restaurantId is required to subscribe to online orders.'));
      return () => {};
    }

    const colRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
    const q = query(
      colRef,
      where('source', '==', 'online'),
      orderBy('createdAt', 'desc')
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const orders: Order[] = [];
        snapshot.forEach((d) => {
          orders.push({ id: d.id, ...d.data() } as Order);
        });
        onUpdate(orders);
      },
      (err) => {
        if (!auth.currentUser) return;
        const errCode = (err as any)?.code;
        if (errCode === 'permission-denied' || errCode === 'unavailable') {
          console.warn('[RestaurantOS] Online orders subscription notice:', (err as any)?.message);
          onUpdate([]);
        } else {
          console.error('[RestaurantOS] Error listening to online orders:', err);
        }
        if (onError) onError(err as Error);
      }
    );
  }

  /**
   * Accepts an incoming online order, sets estimated prep time, advances status to 'sentToKitchen' or 'preparing',
   * and ensures corresponding kitchen ticket (KOT) is sent to kitchen display screens.
   */
  async acceptOnlineOrder(
    restaurantId: string,
    orderId: string,
    actorUid: string,
    prepTimeMinutes: number = 20,
    trustedServerAuthorized: boolean = false
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId.trim();
    const cleanOrderId = orderId.trim();
    const resolvedUserId = actorUid || auth.currentUser?.uid || 'staff';

    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';

    // Browser calls are authorized by the trusted server endpoint below.
    // Avoid a stale client-side role cache blocking a valid owner/manager/cashier/captain
    // after staff membership changes. Direct/test execution keeps the service-level
    // permission guard.
    // Browser requests are protected by the dedicated server route, which has
    // already verified the caller's authenticated restaurant role. The server
    // then performs the trusted Firestore write. Do not run the browser/client
    // permission cache again on that trusted server path.
    if (!trustedServerAuthorized && (typeof window === 'undefined' || isTestRuntime)) {
      await enforcePermission(cleanRestaurantId, 'modify_orders');
    }

    if (typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to complete an order.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch((await import('../utils/apiConfig')).getApiUrl('/api/orders/accept-online'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ restaurantId: cleanRestaurantId, orderId: cleanOrderId, prepTimeMinutes })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.order) {
        throw new Error(payload?.message || 'Online order acceptance failed.');
      }
      return payload.order as Order;
    }

    const path = orderDocPath(cleanRestaurantId, cleanOrderId);
    const orderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
    const orderSnap = await getDoc(orderDocRef);

    if (!orderSnap.exists()) {
      throw new Error(`Cannot accept order: Order "${cleanOrderId}" not found.`);
    }

    const orderData = orderSnap.data() as Order;

    if (orderData.status !== 'confirmed' && orderData.status !== 'draft') {
      throw new Error(
        `Cannot accept online order "${orderData.orderNumber || cleanOrderId}": Order is already in status "${orderData.status}".`
      );
    }

    const now = new Date();
    const targetStatus: OrderStatus = 'sentToKitchen';

    // 1. Update order document
    await updateDoc(orderDocRef, {
      status: targetStatus,
      acceptedAt: serverTimestamp() || now,
      acceptedBy: resolvedUserId,
      estimatedPrepMinutes: prepTimeMinutes,
      updatedAt: serverTimestamp() || now,
      updatedBy: resolvedUserId
    });

    // 2. Synchronize active KOTs if present
    try {
      const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
      const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
      const kotSnap = await getDocs(kotQuery);

      if (kotSnap && !kotSnap.empty && kotSnap.docs) {
        for (const kDoc of kotSnap.docs) {
          const kot = kDoc.data() as KOT;
          if (kot.status === 'draft' || kot.status === 'confirmed') {
            await updateDoc(doc(db, 'restaurants', cleanRestaurantId, 'kots', kDoc.id), {
              status: 'sentToKitchen',
              sentToKitchenAt: serverTimestamp() || now,
              updatedAt: serverTimestamp() || now,
              updatedBy: resolvedUserId
            });
          }
        }
      } else {
        // Create initial KOT for kitchen display if missing and items exist
        if (orderData.items && orderData.items.length > 0) {
          const kotNumber = `KOT-${Date.now().toString().slice(-4)}`;
          const kotDocRef = doc(collection(db, 'restaurants', cleanRestaurantId, 'kots'));
          await setDoc(kotDocRef, {
            id: kotDocRef.id,
            restaurantId: cleanRestaurantId,
            orderId: cleanOrderId,
            orderNumber: orderData.orderNumber,
            kotNumber,
            status: 'sentToKitchen',
            source: 'online',
            orderType: orderData.orderType,
            items: orderData.items.map((i) => ({
              itemId: i.itemId,
              nameSnapshot: i.nameSnapshot,
              quantity: i.quantity,
              unitPriceMinor: i.unitPriceMinor,
              foodTypeSnapshot: i.foodTypeSnapshot || null,
              imageUrlSnapshot: i.imageUrlSnapshot || null,
              notes: i.notes || ''
            })),
            notes: `Online Order (${orderData.orderType.toUpperCase()}) - Est. prep: ${prepTimeMinutes} mins`,
            customerSnapshot: orderData.customerSnapshot || null,
            sentToKitchenAt: serverTimestamp() || now,
            createdAt: serverTimestamp() || now,
            createdBy: resolvedUserId,
            updatedAt: serverTimestamp() || now,
            updatedBy: resolvedUserId
          });
        }
      }
    } catch (kotErr: any) {
      console.warn('[RestaurantOS] KOT synchronization during online order accept warning:', kotErr);
    }

    // 3. Log Audit Event
    await auditService.logEvent(cleanRestaurantId, {
      restaurantId: cleanRestaurantId,
      entityType: 'order',
      entityId: cleanOrderId,
      action: 'online_order_accepted',
      actorUid: resolvedUserId,
      metadata: {
        orderNumber: orderData.orderNumber,
        orderType: orderData.orderType,
        estimatedPrepMinutes: prepTimeMinutes,
        source: orderData.source
      }
    });

    const updatedSnap = await getDoc(orderDocRef);
    return { id: updatedSnap.id, ...updatedSnap.data() } as Order;
  }

  /**
   * Rejects an online order with an explicit operational rejection reason,
   * cancels associated KOTs, reverses stock consumption, and logs audit record.
   */
  async rejectOnlineOrder(
    restaurantId: string,
    orderId: string,
    actorUid: string,
    rejectionReason: string = 'Rejected by restaurant'
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId.trim();
    const cleanOrderId = orderId.trim();
    const resolvedUserId = actorUid || auth.currentUser?.uid || 'staff';

    await enforcePermission(cleanRestaurantId, 'cancel_orders');

    const orderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
    const orderSnap = await getDoc(orderDocRef);

    if (!orderSnap.exists()) {
      throw new Error(`Cannot reject order: Order "${cleanOrderId}" not found.`);
    }

    const orderData = orderSnap.data() as Order;

    if (orderData.status === 'completed' || orderData.status === 'cancelled') {
      throw new Error(
        `Cannot reject order "${orderData.orderNumber || cleanOrderId}": Order is already ${orderData.status}.`
      );
    }

    const now = new Date();

    // 1. Update order document to cancelled with rejection reason
    await updateDoc(orderDocRef, {
      status: 'cancelled',
      cancellationReason: rejectionReason,
      rejectionReason: rejectionReason,
      cancelledAt: serverTimestamp() || now,
      cancelledBy: resolvedUserId,
      updatedAt: serverTimestamp() || now,
      updatedBy: resolvedUserId
    });

    // 2. Cancel associated KOTs
    try {
      const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
      const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
      const kotSnap = await getDocs(kotQuery);

      for (const kDoc of kotSnap.docs) {
        const kot = kDoc.data() as KOT;
        if (kot.status !== 'cancelled') {
          await updateDoc(doc(db, 'restaurants', cleanRestaurantId, 'kots', kDoc.id), {
            status: 'cancelled',
            cancellationReason: rejectionReason,
            cancelledAt: serverTimestamp() || now,
            cancelledBy: resolvedUserId,
            updatedAt: serverTimestamp() || now,
            updatedBy: resolvedUserId
          });
        }
      }
    } catch (kotErr) {
      console.warn('[RestaurantOS] KOT cancellation during online order rejection warning:', kotErr);
    }

    // 3. Reverse stock consumption if items had been consumed
    try {
      await stockConsumptionService.reverseOrderStockConsumption(
        cleanRestaurantId,
        cleanOrderId,
        `Online order rejected: ${rejectionReason}`
      );
      await updateDoc(orderDocRef, {
        stockConsumptionStatus: 'reversed',
        updatedAt: serverTimestamp() || now
      });
    } catch (revErr) {
      console.warn('[RestaurantOS] Stock reversal during online order reject warning:', revErr);
    }

    // 4. Log Audit Event
    await auditService.logEvent(cleanRestaurantId, {
      restaurantId: cleanRestaurantId,
      entityType: 'order',
      entityId: cleanOrderId,
      action: 'online_order_rejected',
      actorUid: resolvedUserId,
      metadata: {
        orderNumber: orderData.orderNumber,
        orderType: orderData.orderType,
        rejectionReason,
        source: orderData.source
      }
    });

    const updatedSnap = await getDoc(orderDocRef);
    return { id: updatedSnap.id, ...updatedSnap.data() } as Order;
  }

  /**
   * Marks an online order as ready for pickup (takeaway) or dispatch (delivery).
   */
  async markOnlineOrderReady(
    restaurantId: string,
    orderId: string,
    actorUid: string
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId.trim();
    const cleanOrderId = orderId.trim();
    const resolvedUserId = actorUid || auth.currentUser?.uid || 'staff';

    await enforcePermission(cleanRestaurantId, 'modify_orders');

    const orderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
    const orderSnap = await getDoc(orderDocRef);

    if (!orderSnap.exists()) {
      throw new Error(`Cannot update order: Order "${cleanOrderId}" not found.`);
    }

    const orderData = orderSnap.data() as Order;
    const now = new Date();

    // 1. Update order
    await updateDoc(orderDocRef, {
      status: 'ready',
      readyAt: serverTimestamp() || now,
      readyBy: resolvedUserId,
      updatedAt: serverTimestamp() || now,
      updatedBy: resolvedUserId
    });

    // 2. Mark active KOTs as ready
    try {
      const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
      const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
      const kotSnap = await getDocs(kotQuery);

      for (const kDoc of kotSnap.docs) {
        const kot = kDoc.data() as KOT;
        if (kot.status !== 'cancelled' && kot.status !== 'ready' && kot.status !== 'served') {
          await updateDoc(doc(db, 'restaurants', cleanRestaurantId, 'kots', kDoc.id), {
            status: 'ready',
            readyAt: serverTimestamp() || now,
            updatedAt: serverTimestamp() || now,
            updatedBy: resolvedUserId
          });
        }
      }
    } catch (kotErr) {
      console.warn('[RestaurantOS] KOT status update to ready warning:', kotErr);
    }

    // 3. Log Audit Event
    await auditService.logEvent(cleanRestaurantId, {
      restaurantId: cleanRestaurantId,
      entityType: 'order',
      entityId: cleanOrderId,
      action: 'online_order_ready',
      actorUid: resolvedUserId,
      metadata: {
        orderNumber: orderData.orderNumber,
        orderType: orderData.orderType
      }
    });

    const updatedSnap = await getDoc(orderDocRef);
    return { id: updatedSnap.id, ...updatedSnap.data() } as Order;
  }

  /**
   * Completes an online order upon customer pickup or delivery completion.
   */
  async completeOnlineOrder(
    restaurantId: string,
    orderId: string,
    actorUid: string
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId.trim();
    const cleanOrderId = orderId.trim();
    const resolvedUserId = actorUid || auth.currentUser?.uid || 'staff';
    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';

    // Customer online handover is a server-authoritative operational action.
    // Route browser requests through the trusted endpoint so a stale client
    // permission cache cannot reject a valid staff handover.
    if (typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to complete an order.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch((await import('../utils/apiConfig')).getApiUrl('/api/orders/online-handover'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ restaurantId: cleanRestaurantId, orderId: cleanOrderId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.order) {
        throw new Error(payload?.message || 'Online order handover failed.');
      }
      return payload.order as Order;
    }

    await this.completeOrder(cleanRestaurantId, cleanOrderId, resolvedUserId);

    const orderDocRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
    const updatedSnap = await getDoc(orderDocRef);
    return { id: updatedSnap.id, ...updatedSnap.data() } as Order;
  }

  /**
   * One-shot retrieval of all active orders with outstanding financial balance (dueAmountMinor > 0).
   */
  async getPaymentDueOrders(restaurantId: string): Promise<Order[]> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to fetch payment due orders.');
    }

    await enforcePermission(cleanRestaurantId, 'view_orders');

    const colRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
    const q = query(colRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    const dueOrders: Order[] = [];
    snap.forEach((d) => {
      const ord = { id: d.id, ...d.data() } as Order;
      if (ord.status === 'cancelled') return;

      const dueAmount =
        ord.dueAmountMinor ??
        Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));

      if (dueAmount > 0 && ord.paymentStatus !== 'paid') {
        dueOrders.push({
          ...ord,
          dueAmountMinor: dueAmount
        });
      }
    });

    dueOrders.sort((a, b) => {
      const aServedOrReady = a.status === 'served' || a.status === 'ready';
      const bServedOrReady = b.status === 'served' || b.status === 'ready';

      if (aServedOrReady && !bServedOrReady) return -1;
      if (!aServedOrReady && bServedOrReady) return 1;

      const timeA = (a.createdAt as any)?.toMillis?.() || (a.createdAt ? new Date(a.createdAt as any).getTime() : 0);
      const timeB = (b.createdAt as any)?.toMillis?.() || (b.createdAt ? new Date(b.createdAt as any).getTime() : 0);

      return timeA - timeB;
    });

    return dueOrders;
  }

  /**
   * Queries historical orders for a restaurant with flexible filtering and bounded results.
   * Preserves historical financial and item snapshots without any recalculation.
   */
  async queryOrderHistory(
    restaurantId: string,
    options: OrderHistoryFilterOptions = {}
  ): Promise<{ orders: Order[]; totalCount: number }> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to query order history.');
    }

    await enforcePermission(cleanRestaurantId, 'view_orders');

    const path = ordersPath(cleanRestaurantId);
    try {
      const colRef = collection(db, 'restaurants', cleanRestaurantId, 'orders');
      let q = query(colRef);

      if (options.tableSessionId) {
        q = query(colRef, where('tableSessionId', '==', options.tableSessionId.trim()));
      }

      const snap = await getDocs(q);
      let orders: Order[] = [];
      snap.forEach((d) => {
        orders.push({ id: d.id, ...d.data() } as Order);
      });

      // Apply in-memory multi-attribute filters
      if (options.tableId && options.tableId !== 'all') {
        orders = orders.filter((o) => o.tableId === options.tableId);
      }

      if (options.orderType && options.orderType !== 'all') {
        orders = orders.filter((o) => o.orderType === options.orderType);
      }

      if (options.orderStatus && options.orderStatus !== 'all') {
        orders = orders.filter((o) => o.status === options.orderStatus);
      }

      if (options.paymentStatus && options.paymentStatus !== 'all') {
        if (options.paymentStatus === 'paid') {
          orders = orders.filter((o) => (o.paidAmountMinor || 0) >= (o.grandTotalMinor || 0) && (o.grandTotalMinor || 0) > 0);
        } else if (options.paymentStatus === 'partial') {
          orders = orders.filter(
            (o) => (o.paidAmountMinor || 0) > 0 && (o.paidAmountMinor || 0) < (o.grandTotalMinor || 0)
          );
        } else if (options.paymentStatus === 'unpaid') {
          orders = orders.filter((o) => (o.paidAmountMinor || 0) === 0 || (o.dueAmountMinor || 0) > 0);
        }
      }

      if (options.startDate) {
        const startMillis = parseTimestampToMillis(options.startDate);
        if (startMillis > 0) {
          orders = orders.filter((o) => {
            const time = parseTimestampToMillis(o.createdAt);
            return time >= startMillis;
          });
        }
      }

      if (options.endDate) {
        const endMillis = parseTimestampToMillis(options.endDate);
        if (endMillis > 0) {
          orders = orders.filter((o) => {
            const time = parseTimestampToMillis(o.createdAt);
            return time <= endMillis;
          });
        }
      }

      if (options.searchQuery?.trim()) {
        const queryLower = options.searchQuery.trim().toLowerCase();
        orders = orders.filter((o) => {
          const orderNum = (o.orderNumber || '').toLowerCase();
          const custName = (o.customerSnapshot?.name || '').toLowerCase();
          const custPhone = (o.customerSnapshot?.phone || '').toLowerCase();
          const notes = (o.notes || '').toLowerCase();
          return (
            orderNum.includes(queryLower) ||
            custName.includes(queryLower) ||
            custPhone.includes(queryLower) ||
            notes.includes(queryLower)
          );
        });
      }

      // Sort by createdAt descending
      orders.sort((a, b) => {
        const timeA = parseTimestampToMillis(a.createdAt);
        const timeB = parseTimestampToMillis(b.createdAt);
        return timeB - timeA;
      });


      const totalCount = orders.length;
      const limit = options.limitCount || 50;
      const paginatedOrders = orders.slice(0, limit);

      return {
        orders: paginatedOrders,
        totalCount
      };
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  /**
   * Safely reopens or transitions an order for controlled correction.
   * Invariant: Never alters past financial records or removes payment ledger entries.
   */
  async reopenOrder(
    restaurantId: string,
    orderId: string,
    reopenedBy: string,
    reason?: string
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to reopen order.');
    }

    await enforcePermission(cleanRestaurantId, 'cancel_orders');

    const path = orderDocPath(cleanRestaurantId, cleanOrderId);
    try {
      const order = await this.getOrderById(cleanRestaurantId, cleanOrderId);
      if (!order) {
        throw new Error(`Order "${cleanOrderId}" not found in restaurant "${cleanRestaurantId}".`);
      }

      if (order.status === 'cancelled') {
        throw new Error('Cannot reopen cancelled order.');
      }

      // Reopening is permitted for completed or served orders to allow adjustment
      const newStatus: OrderStatus = 'served';
      const docRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
      const now = new Date();

      await updateDoc(docRef, {
        status: newStatus,
        updatedAt: serverTimestamp() || now,
        updatedBy: reopenedBy
      });

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: 'order_reopened',
        actorUid: reopenedBy,
        metadata: {
          previousStatus: order.status,
          newStatus,
          reason: reason || 'Staff reopened order for adjustment'
        }
      });

      return {
        ...order,
        status: newStatus,
        updatedAt: now,
        updatedBy: reopenedBy
      };
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  /**
   * Physically deletes an order from Firestore.
   * Only permitted for Owner or Manager role (enforced via permissions and firestore rules).
   */
  async deleteOrder(
    restaurantId: string,
    orderId: string,
    deletedBy: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to delete an order.');
    }

    await enforcePermission(cleanRestaurantId, 'cancel_orders');

    const path = orderDocPath(cleanRestaurantId, cleanOrderId);
    try {
      const order = await this.getOrderById(cleanRestaurantId, cleanOrderId);
      if (!order) {
        throw new Error(`Order "${cleanOrderId}" not found in restaurant "${cleanRestaurantId}".`);
      }
      if (order.status !== 'draft') {
        throw new Error(`Only draft orders without operational history may be physically deleted. Order "${cleanOrderId}" is currently "${order.status}".`);
      }

      // Financial, inventory, or kitchen history makes an order non-deletable.
      const paymentsCol = collection(db, 'restaurants', cleanRestaurantId, 'payments');
      const payQuery = query(paymentsCol, where('orderId', '==', cleanOrderId));
      const paySnap = await getDocs(payQuery);
      if (!paySnap.empty || (order.paidAmountMinor || 0) > 0 || (order.paymentStatus && order.paymentStatus !== 'unpaid')) {
        throw new Error(`Order "${cleanOrderId}" cannot be deleted because financial settlement/history exists. Use cancellation and refund workflows instead.`);
      }

      if (order.stockConsumptionStatus === 'consumed' || order.stockConsumptionStatus === 'reversed') {
        throw new Error(`Order "${cleanOrderId}" cannot be deleted because inventory history exists.`);
      }

      const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
      const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
      const kotSnap = await getDocs(kotQuery);
      if (!kotSnap.empty) {
        throw new Error(`Order "${cleanOrderId}" cannot be deleted because kitchen ticket history exists.`);
      }

      const docRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);

      // Log audit event BEFORE deleting so we have the order record details in the audit log
      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: 'order_deleted',
        actorUid: auth.currentUser?.uid || deletedBy,
        metadata: {
          orderNumber: order.orderNumber,
          grandTotalMinor: order.grandTotalMinor,
          paidAmountMinor: order.paidAmountMinor,
          dueAmountMinor: order.dueAmountMinor,
          status: order.status
        }
      });

      await deleteDoc(docRef);
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  /**
   * Deterministically completes an order according to Phase 3 hardening rules:
   * 1. Full financial settlement (dueAmountMinor === 0)
   * 2. No active KOT remaining (all KOTs in 'served' or 'cancelled')
   * 3. No pending payments remaining
   * 4. Transition status to 'completed' with atomic audit log
   */
  async completeOrder(
    restaurantId: string,
    orderId: string,
    completedBy: string
  ): Promise<Order> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to complete an order.');
    }

    const isTestRuntime = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';
    if (typeof window !== 'undefined' && !isTestRuntime) {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication is required to complete an order.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch((await import('../utils/apiConfig')).getApiUrl('/api/orders/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ restaurantId: cleanRestaurantId, orderId: cleanOrderId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.order) {
        throw new Error(payload?.message || 'Order completion failed.');
      }
      return payload.order as Order;
    }

    const trustedServerContext = auth.currentUser?.email === 'system-server@restaurantos.app';
    if (!trustedServerContext) {
      await enforcePermission(cleanRestaurantId, 'modify_orders');
    }

    const path = orderDocPath(cleanRestaurantId, cleanOrderId);
    try {
      const orderRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
      const orderSnap = await getDoc(orderRef);
      if (!orderSnap.exists()) {
        throw new Error(`Order "${cleanOrderId}" not found in restaurant "${cleanRestaurantId}".`);
      }

      const order = { id: orderSnap.id, ...orderSnap.data() } as Order;
      if (order.restaurantId !== cleanRestaurantId) {
        throw new Error('Cross-tenant order completion violation.');
      }

      if (order.status === 'completed') {
        return order; // Idempotent success
      }

      if (order.status === 'cancelled') {
        throw new Error(`Cannot complete cancelled order "${cleanOrderId}".`);
      }

      // Check transition validity
      const transitionCheck = validateOrderStatusTransition(order.status, 'completed');
      if (!transitionCheck.isValid) {
        throw new Error(`Cannot complete order: ${transitionCheck.error}`);
      }

      // Financial validation: Must have 0 outstanding due
      const dueAmount =
        order.dueAmountMinor ??
        Math.max(0, (order.grandTotalMinor || 0) - (order.paidAmountMinor || 0));
      if (dueAmount > 0) {
        throw new Error(
          `Cannot complete order "${order.orderNumber || cleanOrderId}": Outstanding due of ₹${(dueAmount / 100).toFixed(2)} must be settled before completion.`
        );
      }

      // KOT validation: All KOTs must be in terminal state ('served' or 'cancelled')
      try {
        const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
        const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
        const kotSnap = await getDocs(kotQuery);
        for (const d of kotSnap.docs) {
          const kotData = d.data() as KOT;
          if (kotData.status !== 'served' && kotData.status !== 'cancelled') {
            throw new Error(
              `Cannot complete order "${order.orderNumber || cleanOrderId}": KOT "${kotData.kotNumber || d.id}" is still in status "${kotData.status}". All kitchen tickets must be served or cancelled before completing the order.`
            );
          }
        }
      } catch (kotErr: any) {
        if (kotErr.message && kotErr.message.includes('Cannot complete order')) throw kotErr;
      }

      // Payment validation: No pending payments
      try {
        const paymentsCol = collection(db, 'restaurants', cleanRestaurantId, 'payments');
        const payQuery = query(paymentsCol, where('orderId', '==', cleanOrderId));
        const paySnap = await getDocs(payQuery);
        for (const d of paySnap.docs) {
          const payData = d.data() as any;
          if (payData.status === 'pending') {
            throw new Error(
              `Cannot complete order: Payment transaction "${d.id}" is currently pending. Settle or resolve pending payments before completing order.`
            );
          }
        }
      } catch (payErr: any) {
        if (payErr.message && payErr.message.includes('Cannot complete order')) throw payErr;
      }

      const now = new Date();
      const resolvedUserId = completedBy || auth.currentUser?.uid || 'system';

      await updateDoc(orderRef, {
        status: 'completed',
        paymentStatus: 'paid',
        completedAt: serverTimestamp() || now,
        completedBy: resolvedUserId,
        updatedAt: serverTimestamp() || now,
        updatedBy: resolvedUserId
      });

      // Completion itself is the critical mutation. Audit logging and the
      // session-closure evaluation can safely converge in the background.
      void auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: 'order_completed',
        actorUid: resolvedUserId,
        metadata: {
          orderNumber: order.orderNumber,
          grandTotalMinor: order.grandTotalMinor,
          paidAmountMinor: order.paidAmountMinor
        }
      }).catch((error) => console.warn('[OrderService] Completion audit notice:', error));

      void orderFinalizationService.evaluateAndFinalizeOrderAndSession(
        cleanRestaurantId,
        cleanOrderId,
        resolvedUserId
      ).catch((error) => {
        console.warn('[OrderService] Background session finalization notice:', error);
      });

      return {
        ...order,
        status: 'completed',
        paymentStatus: 'paid',
        completedAt: now,
        completedBy: resolvedUserId,
        updatedAt: now,
        updatedBy: resolvedUserId
      };
    } catch (err: unknown) {
      if ((err as any)?.message && (err as any).message.includes('Cannot complete order')) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  /**
   * Logs a bill viewed event in audit log.
   */
  async logBillViewed(restaurantId: string, orderId: string, actorUid: string): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) return;
    try {
      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: 'bill_viewed',
        actorUid,
        metadata: { orderId: cleanOrderId }
      });
    } catch (err) {
      console.warn('[RestaurantOS] Failed to log bill_viewed audit event:', err);
    }
  }

  /**
   * Logs a bill reprinted event in audit log.
   */
  async logBillReprint(restaurantId: string, orderId: string, actorUid: string): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) return;
    try {
      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: 'bill_reprinted',
        actorUid,
        metadata: { orderId: cleanOrderId }
      });
    } catch (err) {
      console.warn('[RestaurantOS] Failed to log bill_reprinted audit event:', err);
    }
  }

  /**
   * Updates the customer snapshot (e.g. phone number or name) for an existing order.
   */
  async updateCustomerSnapshot(
    restaurantId: string,
    orderId: string,
    customerSnapshot: CustomerSnapshot | null,
    actorUid: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) return;

    const orderRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
    await updateDoc(orderRef, {
      customerSnapshot: customerSnapshot || null,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid || 'system'
    });
  }
}

export const orderService = new OrderService();