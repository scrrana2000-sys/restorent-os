import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { calculateOrderTotals, calculateOrderItemLine } from '../services/orderCalculationService';
import { KOT, KOTItem } from '../types/kot';
import { Order, OrderItem, OrderStatus } from '../types/order';

export async function partiallyCancelKOTItemsWithAdmin(
  restaurantId: string,
  kotId: string,
  cancellations: { itemId: string; cancelledQuantity: number; reason: string }[],
  cancelledBy: string
): Promise<KOT> {
  const rid = restaurantId.trim();
  const kid = kotId.trim();
  if (!rid || !kid || !cancellations.length) throw new Error('restaurantId, kotId and cancellations are required.');

  const kotRef = adminDb.doc(`restaurants/${rid}/kots/${kid}`);
  const kotSnap = await kotRef.get();
  if (!kotSnap.exists) throw new Error(`KOT "${kid}" does not exist.`);
  const kot = { id: kotSnap.id, ...kotSnap.data() } as KOT;

  if (kot.status === 'served' || kot.status === 'cancelled') {
    throw new Error(`KOT "${kid}" can no longer be partially cancelled from status "${kot.status}".`);
  }

  const cancelMap = new Map<string, { qty: number; reason: string }>();
  for (const c of cancellations) {
    const itemId = String(c.itemId || '').trim();
    const qty = Number(c.cancelledQuantity);
    if (!itemId || !Number.isInteger(qty) || qty <= 0) continue;
    const existing = cancelMap.get(itemId);
    cancelMap.set(itemId, {
      qty: (existing?.qty || 0) + qty,
      reason: String(c.reason || existing?.reason || 'Item cancelled')
    });
  }
  if (!cancelMap.size) throw new Error('No valid item cancellations were provided.');

  const now = new Date();
  const updatedKotItems: KOTItem[] = kot.items.map((item) => {
    const req = cancelMap.get(item.itemId);
    if (!req) return { ...item };
    if (req.qty > item.quantity) {
      throw new Error(`Cannot cancel ${req.qty} of "${item.nameSnapshot}". Only ${item.quantity} active in KOT.`);
    }
    const remaining = item.quantity - req.qty;
    return {
      ...item,
      quantity: remaining,
      originalQuantity: item.originalQuantity ?? item.quantity,
      cancelledQuantity: (item.cancelledQuantity || 0) + req.qty,
      cancellationReason: req.reason,
      cancelledAt: now,
      cancelledBy
    };
  });

  const activeKotItems = updatedKotItems.filter((i) => i.quantity > 0);
  const allKotCancelled = activeKotItems.length === 0;
  const newKotStatus: KOT['status'] = allKotCancelled ? 'cancelled' : kot.status;

  const orderRef = adminDb.doc(`restaurants/${rid}/orders/${kot.orderId}`);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error(`Order "${kot.orderId}" does not exist.`);
  const order = { id: orderSnap.id, ...orderSnap.data() } as Order;

  if (order.status === 'completed') throw new Error('Cannot partially cancel items from a completed order.');
  if (order.status === 'cancelled') throw new Error('Cannot partially cancel items from a cancelled order.');

  const updatedOrderItems: OrderItem[] = order.items.map((item) => {
    const req = cancelMap.get(item.itemId);
    if (!req) return { ...item };
    if (req.qty > item.quantity) {
      throw new Error(`Cannot cancel ${req.qty} of "${item.nameSnapshot}". Only ${item.quantity} active in order.`);
    }

    const remaining = item.quantity - req.qty;
    const originalQuantity = item.originalQuantity ?? item.quantity;
    const cancelledQuantity = (item.cancelledQuantity || 0) + req.qty;
    if (remaining > 0) {
      const line = calculateOrderItemLine({
        quantity: remaining,
        unitPriceMinor: item.unitPriceMinor,
        taxRate: item.taxRate,
        taxInclusive: item.taxInclusive,
        discount: item.discountMinor > 0
          ? { type: 'fixed', fixedAmountMinor: Math.round((item.discountMinor * remaining) / item.quantity) }
          : undefined
      });
      return {
        ...item,
        quantity: remaining,
        originalQuantity,
        cancelledQuantity,
        cancellationReason: req.reason,
        cancelledAt: now,
        cancelledBy,
        discountMinor: line.discountMinor,
        lineSubtotalMinor: line.subtotalMinor,
        lineTaxMinor: line.totalTaxMinor,
        lineTotalMinor: line.lineTotalMinor
      };
    }
    return {
      ...item,
      quantity: 0,
      originalQuantity,
      cancelledQuantity,
      cancellationReason: req.reason,
      cancelledAt: now,
      cancelledBy,
      discountMinor: 0,
      lineSubtotalMinor: 0,
      lineTaxMinor: 0,
      lineTotalMinor: 0
    };
  });

  const activeOrderItems = updatedOrderItems.filter((i) => i.quantity > 0);
  let totals = {
    subtotalMinor: 0, discountMinor: 0, taxableAmountMinor: 0,
    cgstMinor: 0, sgstMinor: 0, igstMinor: 0, totalTaxMinor: 0, grandTotalMinor: 0
  };
  if (activeOrderItems.length) {
    const calc = calculateOrderTotals({
      items: activeOrderItems.map((item) => ({
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        taxRate: item.taxRate,
        taxInclusive: item.taxInclusive,
        discount: item.discountMinor > 0 ? { type: 'fixed', fixedAmountMinor: item.discountMinor } : undefined
      })),
      taxJurisdiction: 'intraState'
    });
    totals = {
      subtotalMinor: calc.subtotalMinor,
      discountMinor: calc.discountMinor,
      taxableAmountMinor: calc.taxableAmountMinor,
      cgstMinor: calc.cgstMinor,
      sgstMinor: calc.sgstMinor,
      igstMinor: calc.igstMinor,
      totalTaxMinor: calc.totalTaxMinor,
      grandTotalMinor: calc.grandTotalMinor
    };
  }

  const paidAmountMinor = Number(order.paidAmountMinor || 0);
  if (paidAmountMinor > totals.grandTotalMinor) {
    throw new Error('Cannot reduce the order below the amount already paid. Process the required refund first.');
  }

  const allOrderCancelled = activeOrderItems.length === 0;
  const orderStatus: OrderStatus = allOrderCancelled ? 'cancelled' : order.status;
  const dueAmountMinor = totals.grandTotalMinor - paidAmountMinor;

  await adminDb.runTransaction(async (tx) => {
    const [latestKotSnap, latestOrderSnap] = await Promise.all([tx.get(kotRef), tx.get(orderRef)]);
    if (!latestKotSnap.exists || !latestOrderSnap.exists) throw new Error('KOT or order no longer exists. Please retry.');

    const latestKot = latestKotSnap.data() as KOT;
    const latestOrder = latestOrderSnap.data() as Order;
    if (latestKot.status === 'served' || latestKot.status === 'cancelled') throw new Error('KOT changed and can no longer be cancelled.');
    if (latestOrder.status === 'completed' || latestOrder.status === 'cancelled') throw new Error('Order changed and can no longer be cancelled.');

    tx.update(kotRef, {
      items: updatedKotItems,
      status: newKotStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: cancelledBy,
      ...(allKotCancelled ? {
        cancellationReason: cancellations[0]?.reason || 'All items in KOT cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy
      } : {})
    });

    tx.update(orderRef, {
      items: updatedOrderItems,
      ...totals,
      dueAmountMinor,
      status: orderStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: cancelledBy,
      ...(allOrderCancelled ? {
        cancellationReason: cancellations[0]?.reason || 'All order items cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy
      } : {})
    });
  });

  return {
    ...kot,
    items: updatedKotItems,
    status: newKotStatus,
    updatedBy: cancelledBy,
    updatedAt: now,
    ...(allKotCancelled ? {
      cancellationReason: cancellations[0]?.reason || 'All items in KOT cancelled',
      cancelledBy
    } : {})
  } as KOT;
}
