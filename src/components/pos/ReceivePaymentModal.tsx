import React, { useState, useEffect, useId, useMemo } from 'react';
import { Order } from '../../types/order';
import { Payment, PaymentMethod } from '../../types/payment';
import { Table } from '../../types/table';
import { formatMoney, fromMoneyMinor, toMoneyMinor, isValidMoney } from '../../utils/money';
import { getFormattedTableLabel } from '../../utils/tableLabel';
import { paymentService } from '../../services/paymentService';
import { orderService } from '../../services/orderService';
import { tableService } from '../../services/tableService';
import { offlineSyncService } from '../../services/offlineSyncService';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { CreditCard, Banknote, QrCode, MoreHorizontal, CheckCircle2, AlertCircle, RefreshCw, X, User, Phone, Sparkles, WifiOff } from 'lucide-react';

export interface ReceivePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onPaymentSuccess?: (updatedOrder: Order, payment: Payment) => void;
  tableMap?: Map<string, Table>;
}

export const ReceivePaymentModal: React.FC<ReceivePaymentModalProps> = ({
  isOpen,
  onClose,
  order,
  onPaymentSuccess,
  tableMap: tableMapProp
}) => {
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  const symbol = restaurant?.currencySymbol || '₹';

  const [tables, setTables] = useState<Table[]>([]);
  useEffect(() => {
    if (!isOpen || tableMapProp || !restaurant?.restaurantId) return;
    const unsub = tableService.subscribeToTables(restaurant.restaurantId, (liveTables) => {
      setTables(liveTables);
    });
    return () => unsub();
  }, [isOpen, tableMapProp, restaurant?.restaurantId]);

  const activeTableMap = useMemo(() => {
    if (tableMapProp) return tableMapProp;
    const map = new Map<string, Table>();
    tables.forEach((t) => map.set(t.id, t));
    return map;
  }, [tableMapProp, tables]);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountRupees, setAmountRupees] = useState<string>('');
  const [cashTenderedRupees, setCashTenderedRupees] = useState<string>('');
  const [reference, setReference] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>('');

  const dueMinor = Math.max(0, (order?.grandTotalMinor ?? 0) - (order?.paidAmountMinor ?? 0));
  const dueRupees = fromMoneyMinor(dueMinor);

  // Initialize modal state when opened
  useEffect(() => {
    if (isOpen && order) {
      setAmountRupees(fromMoneyMinor(dueMinor).toString());
      setCashTenderedRupees('');
      setReference('');
      setError(null);
      setSubmitting(false);
      setPaymentMethod('cash');
      // Generate a stable idempotency key for this modal opening session
      setSessionId(`req_pay_${order.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    }
  }, [isOpen, order?.id, dueMinor]);

  if (!isOpen || !order) return null;

  // Calculate entered payment amount in minor units
  const numEntered = Number(amountRupees);
  let payAmountMinor = 0;
  try {
    if (!Number.isNaN(numEntered) && numEntered > 0) {
      payAmountMinor = toMoneyMinor(numEntered);
    }
  } catch {
    payAmountMinor = 0;
  }

  // Cash change calculation
  const numCashTendered = Number(cashTenderedRupees);
  let cashTenderedMinor = 0;
  try {
    if (!Number.isNaN(numCashTendered) && numCashTendered > 0) {
      cashTenderedMinor = toMoneyMinor(numCashTendered);
    }
  } catch {
    cashTenderedMinor = 0;
  }

  const changeDueMinor = paymentMethod === 'cash' && cashTenderedMinor > payAmountMinor
    ? cashTenderedMinor - payAmountMinor
    : 0;

  const isFullDue = payAmountMinor === dueMinor && dueMinor > 0;
  const isOverpayment = payAmountMinor > dueMinor;
  const isInvalidAmount = payAmountMinor <= 0 || !isValidMoney(payAmountMinor);

  const handlePayFullDue = () => {
    setAmountRupees(dueRupees.toString());
    setError(null);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !restaurant?.restaurantId) return;

    // Strict validation
    if (isInvalidAmount) {
      setError('Please enter a valid payment amount greater than zero.');
      return;
    }

    if (isOverpayment) {
      setError(`Payment cannot exceed the outstanding due of ${formatMoney(dueMinor, symbol)}.`);
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const createdPayment = await paymentService.recordPayment(
        restaurant.restaurantId,
        {
          orderId: order.id,
          amountMinor: payAmountMinor,
          method: paymentMethod,
          status: 'completed',
          reference: reference.trim() || (paymentMethod === 'cash' && cashTenderedMinor > payAmountMinor ? `Tendered ${formatMoney(cashTenderedMinor, symbol)}, Change ${formatMoney(changeDueMinor, symbol)}` : null),
          createdBy: user?.uid || 'staff'
        },
        sessionId
      );

      // Fetch fresh order snapshot
      const updatedOrder = await orderService.getOrderById(restaurant.restaurantId, order.id);
      
      if (onPaymentSuccess) {
        onPaymentSuccess(updatedOrder || order, createdPayment);
      }
      onClose();
    } catch (err: any) {
      console.error('Payment submission failed:', err);
      let displayMessage = err?.message || 'Failed to record payment. Please try again.';
      if (typeof displayMessage === 'string' && displayMessage.startsWith('{') && displayMessage.includes('"error"')) {
        try {
          const parsed = JSON.parse(displayMessage);
          if (parsed.error) {
            displayMessage = parsed.error === 'Connection failed.'
              ? 'Database connection failed. Please check your internet connection or try again.'
              : parsed.error;
          }
        } catch {
          // ignore
        }
      }
      setError(displayMessage);
      setSubmitting(false);
    }
  };

  const handleQueueOffline = () => {
    if (!restaurant || !order) return;
    try {
      const queueItem = offlineSyncService.enqueue(
        restaurant.restaurantId,
        'record_payment',
        {
          orderId: order.id,
          amountMinor: payAmountMinor,
          method: paymentMethod,
          status: 'completed',
          reference: reference.trim() || (paymentMethod === 'cash' && cashTenderedMinor > payAmountMinor ? `Tendered ${formatMoney(cashTenderedMinor, symbol)}, Change ${formatMoney(changeDueMinor, symbol)}` : null),
          createdBy: user?.uid || 'staff'
        },
        sessionId
      );

      const optimisticPayment: Payment = {
        id: queueItem.id,
        restaurantId: restaurant.restaurantId,
        orderId: order.id,
        amountMinor: payAmountMinor,
        method: paymentMethod,
        status: 'completed',
        reference: reference.trim() || null,
        createdBy: user?.uid || 'staff',
        createdAt: new Date().toISOString()
      };

      const newPaidMinor = order.paidAmountMinor + payAmountMinor;
      const newDueMinor = Math.max(0, order.grandTotalMinor - newPaidMinor);
      const optimisticOrder: Order = {
        ...order,
        paidAmountMinor: newPaidMinor,
        dueAmountMinor: newDueMinor,
        paymentStatus: newDueMinor === 0 ? 'paid' : 'partially_paid',
        status: newDueMinor === 0 && order.status === 'served' ? 'completed' : order.status
      };

      if (onPaymentSuccess) {
        onPaymentSuccess(optimisticOrder, optimisticPayment);
      }
      onClose();
    } catch (queueErr: any) {
      setError(queueErr?.message || 'Failed to queue offline payment.');
    }
  };

  return (
    <div
      id="receive-payment-modal"
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-150 my-0 sm:my-6 max-h-[94dvh] flex flex-col">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-white">Receive Payment</h3>
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  #{order.orderNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {getFormattedTableLabel(order, activeTableMap)}
              </p>
            </div>
          </div>
          <button
            id="close-receive-payment-modal-btn"
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmitPayment} className="p-4 space-y-3.5 overflow-y-auto flex-1">
          {/* Customer Snapshot if available */}
          {order.customerSnapshot?.name && (
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-700 font-semibold">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>{order.customerSnapshot.name}</span>
              </div>
              {order.customerSnapshot.phone && (
                <div className="flex items-center gap-1 text-slate-500 text-[11px]">
                  <Phone className="w-3 h-3" />
                  <span>{order.customerSnapshot.phone}</span>
                </div>
              )}
            </div>
          )}

          {/* Authoritative Financial Breakdown Card */}
          <div className="bg-slate-900 text-white rounded-xl p-3 shadow-xs space-y-1.5">
            <div className="flex justify-between items-center text-[11px] text-slate-300">
              <span>Grand Total</span>
              <span className="font-bold text-white">{formatMoney(order.grandTotalMinor, symbol)}</span>
            </div>
            <div className="flex justify-between items-center text-[11px] text-slate-300">
              <span>Already Paid</span>
              <span className="font-bold text-emerald-400">{formatMoney(order.paidAmountMinor, symbol)}</span>
            </div>
            <div className="pt-1.5 border-t border-slate-800 flex justify-between items-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-300">Outstanding Due</span>
              <span className="text-base font-black text-rose-400">
                {formatMoney(dueMinor, symbol)}
              </span>
            </div>
          </div>

          {/* Payment Method Tabs */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 mb-1.5 block">
              Select Payment Method
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                id="select-method-cash-btn"
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`flex flex-col items-center justify-center p-2 min-h-[48px] rounded-xl border text-[11px] font-bold transition-all active:scale-95 ${
                  paymentMethod === 'cash'
                    ? 'border-indigo-600 bg-indigo-50/80 text-indigo-700 ring-2 ring-indigo-500/10 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-4 h-4 mb-1" />
                <span>Cash</span>
              </button>

              <button
                id="select-method-upi-btn"
                type="button"
                onClick={() => setPaymentMethod('upi')}
                className={`flex flex-col items-center justify-center p-2 min-h-[48px] rounded-xl border text-[11px] font-bold transition-all active:scale-95 ${
                  paymentMethod === 'upi'
                    ? 'border-indigo-600 bg-indigo-50/80 text-indigo-700 ring-2 ring-indigo-500/10 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <QrCode className="w-4 h-4 mb-1" />
                <span>UPI</span>
              </button>

              <button
                id="select-method-card-btn"
                type="button"
                onClick={() => setPaymentMethod('card')}
                className={`flex flex-col items-center justify-center p-2 min-h-[48px] rounded-xl border text-[11px] font-bold transition-all active:scale-95 ${
                  paymentMethod === 'card'
                    ? 'border-indigo-600 bg-indigo-50/80 text-indigo-700 ring-2 ring-indigo-500/10 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-4 h-4 mb-1" />
                <span>Card</span>
              </button>

              <button
                id="select-method-other-btn"
                type="button"
                onClick={() => setPaymentMethod('other')}
                className={`flex flex-col items-center justify-center p-2 min-h-[48px] rounded-xl border text-[11px] font-bold transition-all active:scale-95 ${
                  paymentMethod === 'other'
                    ? 'border-indigo-600 bg-indigo-50/80 text-indigo-700 ring-2 ring-indigo-500/10 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <MoreHorizontal className="w-4 h-4 mb-1" />
                <span>Other</span>
              </button>
            </div>
          </div>

          {/* Amount to Pay with Shortcut */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-700">
                Payment Amount ({symbol})
              </label>
              {!isFullDue && dueMinor > 0 && (
                <button
                  id="pay-full-due-shortcut-btn"
                  type="button"
                  onClick={handlePayFullDue}
                  className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition-colors flex items-center gap-1 active:scale-95 min-h-[32px]"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Pay Full Due ({formatMoney(dueMinor, symbol)})</span>
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                {symbol}
              </span>
              <input
                id="payment-amount-input"
                type="number"
                min="0.01"
                max={dueRupees}
                step="any"
                value={amountRupees}
                onChange={(e) => {
                  setAmountRupees(e.target.value);
                  setError(null);
                }}
                className={`w-full pl-8 pr-3 py-2.5 text-base font-semibold bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 min-h-[44px] ${
                  isOverpayment ? 'border-rose-300 ring-2 ring-rose-200 bg-rose-50/50' : 'border-slate-200'
                }`}
                placeholder="0.00"
              />
            </div>
            {isOverpayment && (
              <p className="text-[10px] font-semibold text-rose-600 mt-1">
                Amount cannot exceed remaining due of {formatMoney(dueMinor, symbol)}.
              </p>
            )}
          </div>

          {/* Cash Tendered & Change Return helper (for Cash payments) */}
          {paymentMethod === 'cash' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-700">
                  Cash Tendered by Customer (Optional)
                </label>
                <span className="text-[10px] text-slate-400">Calculates change</span>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                  {symbol}
                </span>
                <input
                  id="cash-tendered-input"
                  type="number"
                  min="0"
                  step="any"
                  value={cashTenderedRupees}
                  onChange={(e) => setCashTenderedRupees(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full pl-8 pr-3 py-2.5 text-base font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:font-normal placeholder:text-slate-400 min-h-[44px]"
                />
              </div>
              {changeDueMinor > 0 && (
                <div className="mt-1.5 px-3.5 py-2 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between text-xs text-emerald-900 font-bold">
                  <span>Change to Return:</span>
                  <span className="text-base font-black text-emerald-700 font-mono">
                    {formatMoney(changeDueMinor, symbol)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Reference / Note (Optional) */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 mb-1 block">
              Reference / Note (Optional)
            </label>
            <input
              id="payment-reference-input"
              type="text"
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. UPI Txn ID, Card Auth Code, or memo"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 min-h-[42px]"
            />
          </div>

          {/* Error Banner */}
          {error && (
            <div
              id="payment-error-banner"
              className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1 space-y-2">
                <span className="font-semibold leading-relaxed block">{error}</span>
                {paymentMethod === 'cash' &&
                  (error.toLowerCase().includes('connection') ||
                    error.toLowerCase().includes('offline') ||
                    error.toLowerCase().includes('failed') ||
                    error.toLowerCase().includes('network')) && (
                    <button
                      id="queue-offline-payment-btn"
                      type="button"
                      onClick={handleQueueOffline}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs active:scale-95"
                    >
                      <WifiOff className="w-3.5 h-3.5" />
                      <span>Record & Queue Offline (Auto-syncs later)</span>
                    </button>
                  )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0 pb-safe">
            <button
              id="cancel-payment-btn"
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 min-h-[44px] text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50 active:scale-95"
            >
              Cancel
            </button>
            <button
              id="confirm-payment-btn"
              type="submit"
              disabled={submitting || isInvalidAmount || isOverpayment || dueMinor <= 0}
              className="flex-1 sm:flex-initial px-5 py-2.5 min-h-[44px] text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5 active:scale-95"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirm ({formatMoney(payAmountMinor, symbol)})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
