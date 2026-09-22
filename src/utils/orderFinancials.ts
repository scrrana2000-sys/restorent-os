import { Order } from '../types/order';

export interface DerivedOrderFinancials {
  subtotalMinor: number;
  totalTaxMinor: number;
  grandTotalMinor: number;
}

export function deriveOrderFinancials(order: Pick<Order, 'items'>): DerivedOrderFinancials | null {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return null;

  let subtotalMinor = 0;
  let totalTaxMinor = 0;
  let grandTotalMinor = 0;

  for (const item of items) {
    const subtotal = Number(item.lineSubtotalMinor);
    const tax = Number(item.lineTaxMinor);
    const total = Number(item.lineTotalMinor);
    if (![subtotal, tax, total].every(Number.isFinite)) return null;
    if (![subtotal, tax, total].every(Number.isInteger)) return null;
    if (subtotal < 0 || tax < 0 || total < 0) return null;
    subtotalMinor += subtotal;
    totalTaxMinor += tax;
    grandTotalMinor += total;
  }

  return { subtotalMinor, totalTaxMinor, grandTotalMinor };
}

export function reconcileOrderFinancials<T extends Order>(order: T): T {
  const derived = deriveOrderFinancials(order);
  if (!derived || Number(order.grandTotalMinor ?? 0) === derived.grandTotalMinor) return order;

  const paidAmountMinor = Math.max(0, Number(order.paidAmountMinor ?? 0));
  const dueAmountMinor = Math.max(0, derived.grandTotalMinor - paidAmountMinor);

  return {
    ...order,
    subtotalMinor: derived.subtotalMinor,
    totalTaxMinor: derived.totalTaxMinor,
    grandTotalMinor: derived.grandTotalMinor,
    dueAmountMinor,
    paymentStatus: dueAmountMinor === 0 ? 'paid' : paidAmountMinor > 0 ? 'partially_paid' : 'unpaid'
  };
}
