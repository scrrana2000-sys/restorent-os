import { describe, it, expect } from 'vitest';
import { reconcileCancelledOrderInTableSession } from '../services/orderSessionReconciliation';

describe('Cancelled waiter order table-session reconciliation', () => {
  it('promotes the remaining active order when the canonical order is cancelled', () => {
    expect(reconcileCancelledOrderInTableSession({
      activeOrderId: 'order-a',
      activeOrderIds: ['order-a', 'order-b']
    }, 'order-a')).toEqual({
      activeOrderId: 'order-b',
      activeOrderIds: ['order-b']
    });
  });

  it('preserves the canonical order when a non-canonical order is cancelled', () => {
    expect(reconcileCancelledOrderInTableSession({
      activeOrderId: 'order-a',
      activeOrderIds: ['order-a', 'order-b']
    }, 'order-b')).toEqual({
      activeOrderId: 'order-a',
      activeOrderIds: ['order-a']
    });
  });

  it('clears the canonical pointer when the cancelled order is the only active order', () => {
    expect(reconcileCancelledOrderInTableSession({
      activeOrderId: 'order-a',
      activeOrderIds: ['order-a']
    }, 'order-a')).toEqual({
      activeOrderId: null,
      activeOrderIds: []
    });
  });
});
