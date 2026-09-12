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
  runTransaction
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
import { enforcePermission } from '../utils/permissions';
import { auditService } from './auditService';
import { sanitizeFirestoreData } from '../utils/sanitize';
import { stockConsumptionService } from './stockConsumptionService';
import { orderFinalizationService } from './orderFinalizationService';
import { parseTimestampToMillis } from '../utils/dateUtils';

export interface CreateOrderFromCartInput {
  restaurantId: string;
  cartState: CartState;
  orderType: OrderType;
  source: OrderSource;
  tableId?: string | null;
  tableSessionId?: string | null;
  customerSnapshot?: CustomerSnapshot | null;
  notes?: string;
  taxJurisdiction?: TaxJurisdiction;
  createdBy?: string;
  clientRequestId?: string; // Phase 2G idempotency preparation
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
      return { id: snap.id, ...snap.data() } as Order;
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
        orders.push({ id: d.id, ...d.data() } as Order);
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
      createdBy
    } = input;

    if (!restaurantId || typeof restaurantId !== 'string' || restaurantId.trim() === '') {
      throw new Error('Valid restaurantId is required to create an order.');
    }

    const cleanRestaurantId = restaurantId.trim();

    await enforcePermission(cleanRestaurantId, 'create_orders');

    // 1. Validate Dine-In Pre-conditions
    if (orderType === 'dineIn') {
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
        await stockConsumptionService.consumeStockForOrder(cleanRestaurantId, {
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
      createdBy: resolvedUserId,
      updatedBy: resolvedUserId
    };

    // 4. Validate complete order structure and financial invariants
    const validation = validateOrder(orderPayload);
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
    await enforcePermission(cleanRestaurantId, 'create_orders');

    // 1. Validate Dine-In Pre-conditions
    if (orderType === 'dineIn') {
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

      await updateDoc(existingOrderDocRef, sanitizedOrderUpdate);
      await setDoc(kotDocRef, sanitizedKotDoc);

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
        const consumptionResult = await stockConsumptionService.consumeStockForOrder(cleanRestaurantId, {
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
      createdBy: resolvedUserId,
      updatedBy: resolvedUserId
    };

    // 4. Validate complete order structure
    const orderValidation = validateOrder(orderPayload);
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const kotFirestoreDoc = sanitizeFirestoreData({
        ...kotPayload,
        id: kotDocRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Write Order and KOT
      await setDoc(orderDocRef, orderFirestoreDoc);
      await setDoc(kotDocRef, kotFirestoreDoc);

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
        const consumptionResult = await stockConsumptionService.consumeStockForOrder(cleanRestaurantId, {
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
    const validation = validateOrder(orderData);
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

      await auditService.logEvent(cleanRestaurantId, {
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
      });

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

      // Automatic recipe stock consumption for confirmed order: tracked authoritatively
      try {
        const consumptionResult = await stockConsumptionService.consumeStockForOrder(cleanRestaurantId, {
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

    // 2c. If transitioning to 'cancelled', check 2-minute waiting period and auto-cancel KOTs in waiting
    if (newStatus === 'cancelled') {
      try {
        const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
        const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
        const kotSnap = await getDocs(kotQuery);

        // 1. Enforce 2-minute grace period check for each associated KOT
        for (const d of kotSnap.docs) {
          const kotData = d.data() as KOT;
          const sentAt = kotData.sentToKitchenAt || kotData.createdAt;
          if (sentAt && kotData.status !== 'cancelled') {
            const sentTime = (sentAt as any).toDate ? (sentAt as any).toDate() : new Date(sentAt as any);
            const diffMinutes = (Date.now() - sentTime.getTime()) / (1000 * 60);
            if (diffMinutes > 2) {
              throw new Error(
                `Cannot cancel order from POS: The 2-minute waiting period has passed. Active KOT "${kotData.kotNumber || d.id}" was sent to the kitchen ${Math.floor(diffMinutes)} minutes ago. This order can now only be cancelled from the kitchen display screen (KOT).`
              );
            }
          }
        }

        // 2. Auto-cancel associated KOTs that are in 'waiting' ('sentToKitchen' or 'confirmed') status
        const resolvedUserId = updatedBy || auth.currentUser?.uid || 'system';
        const now = new Date();

        for (const d of kotSnap.docs) {
          const kotData = d.data() as KOT;
          if (kotData.status === 'sentToKitchen' || kotData.status === 'confirmed') {
            const kotRef = doc(db, 'restaurants', cleanRestaurantId, 'kots', d.id);
            await updateDoc(kotRef, {
              status: 'cancelled',
              cancellationReason: cancellationReason || 'Cancelled automatically due to POS order cancellation within 2 minutes grace period',
              cancelledAt: serverTimestamp() || now,
              cancelledBy: resolvedUserId,
              updatedAt: serverTimestamp() || now,
              updatedBy: resolvedUserId
            });

            // Log audit event for auto-cancelled KOT
            await auditService.logEvent(cleanRestaurantId, {
              restaurantId: cleanRestaurantId,
              entityType: 'kot',
              entityId: d.id,
              action: 'kot_cancelled_auto_pos',
              actorUid: resolvedUserId,
              metadata: {
                kotNumber: kotData.kotNumber,
                orderId: cleanOrderId,
                reason: 'Auto-cancelled because parent order was cancelled within 2 minutes'
              }
            });
          }
        }
      } catch (err: any) {
        if (err.message && err.message.includes('Cannot cancel order from POS')) throw err;
        console.warn('[RestaurantOS] KOT cancel lookup or update warning:', err);
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
        updatePayload.cancellationReason = cancellationReason || 'Cancelled by staff';
        updatePayload.cancelledAt = serverTimestamp() || now;
        updatePayload.cancelledBy = resolvedUserId;
      }

      await updateDoc(docRef, updatePayload);

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
      const res = await stockConsumptionService.consumeStockForOrder(cleanRestId, {
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

    await enforcePermission(cleanRestaurantId, 'create_orders');

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
    const dueAmountMinor = Math.max(0, grandTotalMinor - paidAmountMinor);

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
    await updateDoc(orderRef, sanitizedPayload);

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
          orders.push({ id: d.id, ...d.data() } as Order);
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
          const ord = { id: d.id, ...d.data() } as Order;
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

    await enforcePermission(cleanRestaurantId, 'modify_orders');

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

      // 1. Delete associated payments so they don't corrupt payments analytics or history
      try {
        const paymentsCol = collection(db, 'restaurants', cleanRestaurantId, 'payments');
        const payQuery = query(paymentsCol, where('orderId', '==', cleanOrderId));
        const paySnap = await getDocs(payQuery);
        for (const payDoc of paySnap.docs) {
          await deleteDoc(doc(db, 'restaurants', cleanRestaurantId, 'payments', payDoc.id));
        }
      } catch (payErr) {
        console.warn('[RestaurantOS] Failed to delete associated payments for deleted order:', payErr);
      }

      // 2. Delete associated KOTs to avoid orphaned kitchen tickets
      try {
        const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
        const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
        const kotSnap = await getDocs(kotQuery);
        for (const kotDoc of kotSnap.docs) {
          await deleteDoc(doc(db, 'restaurants', cleanRestaurantId, 'kots', kotDoc.id));
        }
      } catch (kotErr) {
        console.warn('[RestaurantOS] Failed to delete associated KOTs for deleted order:', kotErr);
      }

      const docRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);

      // Log audit event BEFORE deleting so we have the order record details in the audit log
      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'order',
        entityId: cleanOrderId,
        action: 'order_deleted',
        actorUid: deletedBy,
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

    await enforcePermission(cleanRestaurantId, 'modify_orders');

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

      await auditService.logEvent(cleanRestaurantId, {
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
      });

      // Evaluate table session auto-closure
      try {
        await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
          cleanRestaurantId,
          cleanOrderId,
          resolvedUserId
        );
      } catch (autoErr) {
        console.warn('[OrderService] Notice: auto session closure check after completeOrder encountered:', autoErr);
      }

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
}

export const orderService = new OrderService();
