import React, { useState } from 'react';
import { X, AlertTriangle, AlertCircle, Loader2, Ban } from 'lucide-react';
import { Order } from '../../types/order';
import { formatMoney } from '../../utils/money';
import { useRestaurant } from '../../context/RestaurantContext';

interface OnlineOrderRejectModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onReject: (orderId: string, rejectionReason: string) => Promise<void>;
  isSubmitting?: boolean;
}

const COMMON_REASONS = [
  'Kitchen at peak capacity / high load',
  'Item(s) currently out of stock',
  'Delivery address outside serviceable area',
  'Restaurant closing soon for the day',
  'Unable to fulfill special dietary request'
];

export const OnlineOrderRejectModal: React.FC<OnlineOrderRejectModalProps> = ({
  order,
  isOpen,
  onClose,
  onReject,
  isSubmitting = false
}) => {
  const { restaurant } = useRestaurant();
  const symbol = restaurant?.currencySymbol || '₹';
  const [selectedReason, setSelectedReason] = useState<string>(COMMON_REASONS[0]);
  const [customReason, setCustomReason] = useState<string>('');
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !order) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalReason = isCustom ? customReason.trim() : selectedReason;
    if (!finalReason) {
      setError('Please select or specify a reason for rejecting the order.');
      return;
    }
    setError(null);
    try {
      await onReject(order.id, finalReason);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to reject order. Please try again.');
    }
  };

  return (
    <div
      id="online-order-reject-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        id="online-order-reject-modal"
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-rose-950 text-white flex items-center justify-between border-b border-rose-900">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center">
              <Ban className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Reject Online Order #{order.orderNumber}
              </h2>
              <p className="text-[11px] text-rose-300/80">
                The customer will be notified of the cancellation reason
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-rose-300 hover:text-white hover:bg-rose-900/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Warning notice */}
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-900 space-y-1">
              <p className="font-bold">Are you sure you want to decline this order?</p>
              <p className="text-rose-700 leading-relaxed">
                Order #{order.orderNumber} for {order.customerSnapshot?.name || 'Customer'} (
                {formatMoney(order.grandTotalMinor, symbol)}) will be marked as cancelled. Any
                reserved stock will be immediately restored.
              </p>
            </div>
          </div>

          {/* Reason Selection */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-800">
              Select Rejection Reason
            </label>
            <div className="space-y-2">
              {COMMON_REASONS.map((r) => {
                const isSelected = !isCustom && selectedReason === r;
                return (
                  <label
                    key={r}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-rose-50/50 border-rose-400 text-rose-900 font-semibold ring-1 ring-rose-400/20'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="rejection-reason"
                      checked={isSelected}
                      onChange={() => {
                        setIsCustom(false);
                        setSelectedReason(r);
                      }}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span>{r}</span>
                  </label>
                );
              })}

              {/* Custom Reason */}
              <label
                className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                  isCustom
                    ? 'bg-rose-50/50 border-rose-400 text-rose-900 font-semibold ring-1 ring-rose-400/20'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="rejection-reason"
                  checked={isCustom}
                  onChange={() => setIsCustom(true)}
                  className="text-rose-600 focus:ring-rose-500"
                />
                <span>Custom / Other Reason</span>
              </label>

              {isCustom && (
                <textarea
                  rows={2}
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Explain why the order cannot be fulfilled..."
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-rose-300 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  autoFocus
                />
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Keep Order
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              id="confirm-reject-online-order-btn"
              className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/20 flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Rejecting Order...</span>
                </>
              ) : (
                <>
                  <Ban className="w-4 h-4" />
                  <span>Confirm Rejection</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
