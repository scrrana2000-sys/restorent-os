import React, { useEffect, useState } from 'react';
import { Table, TableSession } from '../../types/table';
import { Order } from '../../types/order';
import { KOT } from '../../types/kot';
import { reconcileOrderFinancials } from '../../utils/orderFinancials';
import {
  X,
  Users,
  Clock,
  Utensils,
  CookingPot,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  CreditCard,
  LogOut,
  Send,
  Ban,
  AlertTriangle
} from 'lucide-react';

interface ActiveSessionModalProps {
  isOpen: boolean;
  table: Table | null;
  session: TableSession | null;
  order: Order | null;
  kots: KOT[];
  onClose: () => void;
  onSendKotToKitchen: (orderId: string, tableId: string) => Promise<void>;
  onCloseSession: (sessionId: string) => Promise<void>;
  onCloseSessionWithAutoResolve?: (sessionId: string, autoCompleteOrderId?: string) => Promise<void>;
  onCompleteOrder?: (orderId: string) => Promise<void>;
  onCancelOrder?: (orderId: string, reason: string) => Promise<void>;
  onSettlePayment?: (order: Order) => void;
  onUpdateGuestCount?: (sessionId: string, newGuestCount: number) => Promise<void>;
  onUpdateKotStatus?: (kotId: string, newStatus: any) => Promise<void>;
  onTakeOrder?: (table: Table) => void;
  onGoToPosOrder: (tableId: string) => void;
  onGoToPosSettlement: (tableId: string) => void;
  isSubmitting: boolean;
}

export const ActiveSessionModal: React.FC<ActiveSessionModalProps> = ({
  isOpen,
  table,
  session,
  order,
  kots,
  onClose,
  onSendKotToKitchen,
  onCloseSession,
  onCloseSessionWithAutoResolve,
  onCompleteOrder,
  onCancelOrder,
  onSettlePayment,
  onUpdateGuestCount,
  onUpdateKotStatus,
  onTakeOrder,
  onGoToPosOrder,
  onGoToPosSettlement,
  isSubmitting
}) => {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isOpen || !order) return;
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isOpen, order?.id]);


  if (!isOpen || !table || !session) return null;

  // Filter KOTs for this table
  const tableKots = kots.filter((k) => k.tableId === table.id);

  // Calculate elapsed session time
  let elapsedMinutes = 0;
  if (session.openedAt) {
    const openedTime =
      typeof session.openedAt?.toDate === 'function'
        ? session.openedAt.toDate().getTime()
        : new Date(session.openedAt).getTime();
    if (!isNaN(openedTime)) {
      elapsedMinutes = Math.max(0, Math.floor((Date.now() - openedTime) / (1000 * 60)));
    }
  }

  // Active order metrics
  const displayOrder = order ? reconcileOrderFinancials(order) : null;
  const createdAtValue: any = displayOrder?.createdAt;
  const createdAt = createdAtValue?.toDate
    ? createdAtValue.toDate()
    : createdAtValue instanceof Date
      ? createdAtValue
      : createdAtValue
        ? new Date(createdAtValue)
        : null;
  const createdAtMs = createdAt?.getTime?.() ?? NaN;
  const orderCancelWindowOpen =
    Number.isFinite(createdAtMs) &&
    nowMs >= createdAtMs &&
    nowMs <= createdAtMs + 2 * 60 * 1000;
  const remainingCancelSeconds = Number.isFinite(createdAtMs)
    ? Math.max(0, Math.ceil((createdAtMs + 2 * 60 * 1000 - nowMs) / 1000))
    : 0;
  const isOrderActive = !!displayOrder && displayOrder.status !== 'completed' && displayOrder.status !== 'cancelled';
  const dueAmountMinor = displayOrder && displayOrder.status !== 'cancelled'
    ? (displayOrder.dueAmountMinor ?? Math.max(0, (displayOrder.grandTotalMinor || 0) - (displayOrder.paidAmountMinor || 0)))
    : 0;
  const isOrderFullyPaid = isOrderActive && dueAmountMinor === 0;

  const activeCookingKots = tableKots.filter(
    (k) => k.status !== 'served' && k.status !== 'cancelled'
  );
  const hasActiveCookingKots = activeCookingKots.length > 0;

  // Can the order be safely completed right now?
  const canCompleteOrder = isOrderActive && isOrderFullyPaid && !hasActiveCookingKots;

  const handleSendKot = async () => {
    if (!order) return;
    setActionError(null);
    try {
      await onSendKotToKitchen(displayOrder.id, table.id);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to dispatch KOT to kitchen.');
    }
  };

  const handleCompleteOrderAction = async () => {
    if (!order || !onCompleteOrder) return;
    setActionError(null);
    try {
      await onCompleteOrder(displayOrder.id);
      setActionSuccess(`Order #${displayOrder.orderNumber} completed successfully.`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to complete displayOrder.');
    }
  };

  const handleConfirmCancelOrder = async () => {
    if (!order || !onCancelOrder) return;
    if (!cancelReason.trim()) {
      setActionError('Cancellation reason is required.');
      return;
    }
    setActionError(null);
    try {
      await onCancelOrder(displayOrder.id, cancelReason.trim());
      setShowCancelPrompt(false);
      setCancelReason('');
      setActionSuccess(`Order #${displayOrder.orderNumber} cancelled.`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to cancel displayOrder.');
    }
  };

  const handleCloseSessionAction = async () => {
    setActionError(null);

    // If order is still active, handle gracefully rather than failing
    if (isOrderActive) {
      if (canCompleteOrder) {
        // Order is fully settled and ready to be completed
        setShowCloseConfirm(true);
        return;
      } else if (dueAmountMinor > 0) {
        setActionError(
          `Cannot close session: Order "${displayOrder.orderNumber || displayOrder.id}" has an unpaid balance of ₹${(dueAmountMinor / 100).toFixed(2)}. Please settle the bill or cancel the order first.`
        );
        return;
      } else if (hasActiveCookingKots) {
        setActionError(
          `Cannot close session: Kitchen is still preparing ${activeCookingKots.length} ticket(s) for Order "${displayOrder.orderNumber || displayOrder.id}". Kitchen orders must be served or cancelled first.`
        );
        return;
      }
    }

    try {
      if (onCloseSessionWithAutoResolve) {
        await onCloseSessionWithAutoResolve(session.id);
      } else {
        await onCloseSession(session.id);
      }
      onClose();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to close table session.');
    }
  };

  const handleCompleteAndCloseSession = async () => {
    if (!order) return;
    setActionError(null);
    try {
      if (onCloseSessionWithAutoResolve) {
        await onCloseSessionWithAutoResolve(session.id, displayOrder.id);
      } else {
        if (onCompleteOrder) {
          await onCompleteOrder(displayOrder.id);
        }
        await onCloseSession(session.id);
      }
      setShowCloseConfirm(false);
      onClose();
    } catch (err: any) {
      setShowCloseConfirm(false);
      setActionError(err?.message || 'Failed to complete order and close session.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-xl p-4 sm:p-6 text-white shadow-2xl animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 flex flex-col max-h-[92vh] max-h-dvh-screen pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight leading-tight">
                  Table {table.tableNumber} — Active Session
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30 whitespace-nowrap">
                  Occupied
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 leading-tight">
                <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800 rounded-lg px-2 py-0.5">
                  <span className="font-semibold text-slate-300 whitespace-nowrap">{session.guestCount} Guests</span>
                  {onUpdateGuestCount && (
                    <div className="flex items-center gap-1 ml-1 border-l border-slate-800 pl-1">
                      <button
                        type="button"
                        data-testid="btn-decrement-guests"
                        disabled={isSubmitting || session.guestCount <= 1}
                        onClick={async () => {
                          setActionError(null);
                          try {
                            await onUpdateGuestCount(session.id, session.guestCount - 1);
                          } catch (err: any) {
                            setActionError(err?.message || 'Failed to update guest count');
                          }
                        }}
                        className="w-5 h-5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 flex items-center justify-center font-bold text-xs disabled:opacity-30 active:scale-90"
                        title="Reduce guests"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        data-testid="btn-increment-guests"
                        disabled={isSubmitting || session.guestCount >= table.capacity}
                        onClick={async () => {
                          setActionError(null);
                          try {
                            await onUpdateGuestCount(session.id, session.guestCount + 1);
                          } catch (err: any) {
                            setActionError(err?.message || 'Failed to update guest count');
                          }
                        }}
                        className="w-5 h-5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 flex items-center justify-center font-bold text-xs disabled:opacity-30 active:scale-90"
                        title="Increase guests"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                <span>•</span>
                <span className="whitespace-nowrap">Opened {elapsedMinutes}m ago</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Error Banner */}
        {actionError && (
          <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-rose-400 hover:text-rose-200 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Action Success Banner */}
        {actionSuccess && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Close Confirmation Prompt Modal */}
        {showCloseConfirm && order && (
          <div className="mt-3 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-xs space-y-3 shrink-0">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-white text-sm">Complete Order & Close Session?</p>
                <p className="text-slate-300 mt-1">
                  Order <strong>#{displayOrder.orderNumber}</strong> is fully settled (₹0.00 due) and all items are served.
                  Would you like to complete this order and close the table session now?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="h-9 px-3 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="btn-confirm-complete-and-close"
                disabled={isSubmitting}
                onClick={handleCompleteAndCloseSession}
                className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Complete Order & Close Table</span>
              </button>
            </div>
          </div>
        )}

        {/* Cancel Order Prompt */}
        {showCancelPrompt && order && orderCancelWindowOpen && (
          <div className="mt-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs space-y-3 shrink-0">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-white text-sm">Cancel Order #{displayOrder.orderNumber}?</p>
                <p className="text-slate-300 mt-0.5">
                  Cancelling will mark this order as cancelled, allowing you to immediately close or reuse the table.
                </p>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter cancellation reason (e.g. Customer left, Entered in error)..."
                  className="w-full mt-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelPrompt(false)}
                className="h-9 px-3 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700"
              >
                Keep Order
              </button>
              <button
                type="button"
                data-testid="btn-confirm-cancel-order"
                disabled={isSubmitting}
                onClick={handleConfirmCancelOrder}
                className="h-9 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Confirm Cancel Order</span>
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="my-3 space-y-3 overflow-y-auto flex-1 pr-0.5">
          {/* Active Order Section */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Utensils className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  {order ? `Order #${displayOrder.orderNumber}` : 'No Active Order'}
                </h3>
              </div>
              {order && (
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border whitespace-nowrap ${
                      displayOrder.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : displayOrder.status === 'cancelled'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    }`}
                  >
                    {displayOrder.status}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${
                      dueAmountMinor === 0
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {dueAmountMinor === 0 ? 'Paid' : `Due ₹${(dueAmountMinor / 100).toFixed(2)}`}
                  </span>
                </div>
              )}
            </div>

            {order ? (
              <div className="space-y-3">
                {/* Financial Summary Strip */}
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800/90 text-center">
                  <div className="flex flex-col justify-center min-h-[44px]">
                    <span className="text-[10px] font-semibold text-slate-400 block leading-tight">Total</span>
                    <span className="font-bold text-white text-xs sm:text-sm mt-0.5 leading-tight">₹{((displayOrder.grandTotalMinor || 0) / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col justify-center min-h-[44px] border-x border-slate-800">
                    <span className="text-[10px] font-semibold text-slate-400 block leading-tight">Paid</span>
                    <span className="font-bold text-emerald-400 text-xs sm:text-sm mt-0.5 leading-tight">₹{((displayOrder.paidAmountMinor || 0) / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col justify-center min-h-[44px]">
                    <span className="text-[10px] font-semibold text-slate-400 block leading-tight">Due Balance</span>
                    <span className={`font-bold text-xs sm:text-sm mt-0.5 leading-tight ${dueAmountMinor > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                      ₹{(dueAmountMinor / 100).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Direct Order Resolution Action Banner */}
                {isOrderActive && (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    {canCompleteOrder ? (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span className="whitespace-nowrap">Bill settled & served</span>
                      </div>
                    ) : dueAmountMinor > 0 ? (
                      <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span className="whitespace-nowrap">Unpaid ₹{(dueAmountMinor / 100).toFixed(2)}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-indigo-300 font-semibold">
                        <CookingPot className="w-4 h-4 shrink-0" />
                        <span className="whitespace-nowrap">Kitchen preparing</span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Complete Order Button */}
                      {canCompleteOrder && onCompleteOrder && (
                        <button
                          type="button"
                          data-testid="btn-captain-complete-order"
                          disabled={isSubmitting}
                          onClick={handleCompleteOrderAction}
                          className="h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition-colors whitespace-nowrap"
                          title="Complete this order"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Complete</span>
                        </button>
                      )}

                      {/* Settle Bill Button */}
                      {dueAmountMinor > 0 && (
                        <button
                          type="button"
                          data-testid="btn-captain-settle-due"
                          onClick={() => {
                            if (onSettlePayment) {
                              onSettlePayment(order);
                            } else {
                              onClose();
                              onGoToPosSettlement(table.id);
                            }
                          }}
                          className="h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition-colors whitespace-nowrap"
                          title="Settle unpaid bill"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>Settle Bill</span>
                        </button>
                      )}

                      {/* Cancel Order Trigger */}
                      {onCancelOrder && orderCancelWindowOpen && (
                        <button
                          type="button"
                          data-testid="btn-trigger-cancel-order"
                          onClick={() => setShowCancelPrompt(true)}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 flex items-center justify-center font-bold text-xs transition-colors shrink-0"
                          title="Cancel order"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Ordered Items List */}
                <div className="space-y-1.5">
                  <div className="text-xs text-slate-400 font-semibold">Ordered Items ({displayOrder.items?.length || 0}):</div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {displayOrder.items?.map((item, idx) => (
                      <div
                        key={item.itemId + idx}
                        className="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-slate-800 text-amber-400 font-bold flex items-center justify-center text-[11px] shrink-0">
                            {item.quantity}x
                          </span>
                          <span className="font-semibold text-slate-200 truncate">{item.nameSnapshot}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.notes && (
                            <span className="text-[10px] italic text-slate-400 truncate max-w-[120px]">
                              "{item.notes}"
                            </span>
                          )}
                          <span className="text-slate-300 text-xs font-mono font-bold">
                            ₹{(((item.unitPriceMinor || 0) * (item.quantity || 1)) / 100).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">
                There is currently no active order associated with this table session.
              </p>
            )}
          </div>

          {/* Kitchen KOT Progress Section */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CookingPot className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Kitchen Order Tickets (KOTs)</h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">{tableKots.length} KOTs</span>
            </div>

            {tableKots.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No KOT tickets dispatched yet.</p>
            ) : (
              <div className="space-y-2">
                {tableKots.map((kot) => (
                  <div
                    key={kot.id}
                    className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-200">{kot.kotNumber}</span>
                      <span className="text-[11px] text-slate-400 ml-2">
                        ({kot.items.length} items)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border whitespace-nowrap ${
                          kot.status === 'sentToKitchen'
                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                            : kot.status === 'preparing'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : kot.status === 'ready'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 animate-pulse'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {kot.status}
                      </span>
                      {kot.status === 'ready' && onUpdateKotStatus && (
                        <button
                          type="button"
                          data-testid={`session-btn-serve-kot-${kot.id}`}
                          onClick={async () => {
                            setActionError(null);
                            try {
                              await onUpdateKotStatus(kot.id, 'served');
                            } catch (err: any) {
                              setActionError(err?.message || 'Failed to serve KOT');
                            }
                          }}
                          className="h-6 px-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition-colors whitespace-nowrap"
                        >
                          Serve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Operational Controls */}
        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Close Session */}
          <button
            type="button"
            data-testid="btn-close-session"
            onClick={handleCloseSessionAction}
            disabled={isSubmitting}
            className="h-11 min-h-[44px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors border border-slate-700 active:scale-95 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-400" />
            <span>Close Session</span>
          </button>

          <div className="flex items-center gap-2">
            {/* Take Order / Add Items */}
            <button
              type="button"
              data-testid="btn-captain-add-order"
              onClick={() => {
                onClose();
                if (onTakeOrder) {
                  onTakeOrder(table);
                } else {
                  onGoToPosOrder(table.id);
                }
              }}
              className="h-11 min-h-[44px] px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm active:scale-95 whitespace-nowrap"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{order ? 'Add Items' : 'Take Order'}</span>
            </button>

            {/* Send KOT if order exists */}
            {order && (
              <button
                type="button"
                data-testid="btn-captain-send-kot"
                onClick={handleSendKot}
                disabled={isSubmitting}
                className="h-11 min-h-[44px] px-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 active:scale-95 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send KOT</span>
              </button>
            )}

            {/* POS Settlement Link */}
            <button
              type="button"
              data-testid="btn-captain-settlement"
              onClick={() => {
                if (order && onSettlePayment) {
                  onSettlePayment(order);
                } else {
                  onClose();
                  onGoToPosSettlement(table.id);
                }
              }}
              className="h-11 min-h-[44px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors active:scale-95 whitespace-nowrap"
              title="Navigate to POS Terminal for Billing & Settlement"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>POS Billing</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

