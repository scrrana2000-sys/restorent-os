import React, { useState } from 'react';
import { Clock, CheckCircle2, X, AlertCircle, Loader2, Utensils, ShoppingBag, Truck } from 'lucide-react';
import { Order } from '../../types/order';
import { formatMoney } from '../../utils/money';
import { useRestaurant } from '../../context/RestaurantContext';

interface OnlineOrderAcceptModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onAccept: (orderId: string, prepTimeMinutes: number) => Promise<void>;
  isSubmitting?: boolean;
}

const PRESET_PREP_TIMES = [15, 20, 30, 45, 60];

export const OnlineOrderAcceptModal: React.FC<OnlineOrderAcceptModalProps> = ({
  order,
  isOpen,
  onClose,
  onAccept,
  isSubmitting = false
}) => {
  const { restaurant } = useRestaurant();
  const symbol = restaurant?.currencySymbol || '₹';
  const [selectedPrepTime, setSelectedPrepTime] = useState<number>(20);
  const [customPrepTime, setCustomPrepTime] = useState<string>('');
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !order) return null;

  const handlePresetClick = (minutes: number) => {
    setIsCustom(false);
    setSelectedPrepTime(minutes);
    setError(null);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomPrepTime(e.target.value);
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) {
      setSelectedPrepTime(val);
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalMinutes = isCustom ? parseInt(customPrepTime, 10) : selectedPrepTime;
    if (!finalMinutes || finalMinutes <= 0 || finalMinutes > 240) {
      setError('Please provide a valid preparation time between 1 and 240 minutes.');
      return;
    }
    setError(null);
    try {
      await onAccept(order.id, finalMinutes);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to accept order. Please try again.');
    }
  };

  return (
    <div
      id="online-order-accept-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        id="online-order-accept-modal"
        className="w-full max-w-lg bg-white rounded-xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-2 sm:my-8 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-white tracking-tight leading-snug">
                Accept Online Order #{order.orderNumber}
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400 leading-snug">
                Set estimated preparation time to notify kitchen & customer
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-3.5 sm:p-6 space-y-3.5 sm:space-y-5">
          {/* Order Snapshot Card */}
          <div className="p-2.5 sm:p-3.5 bg-slate-50 border border-slate-200 rounded-lg sm:rounded-xl space-y-1.5 sm:space-y-2 text-[11px] sm:text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span className="font-semibold">Customer:</span>
              <span className="font-bold text-slate-900">
                {order.customerSnapshot?.name || 'Customer'}
                {order.customerSnapshot?.phone ? ` (${order.customerSnapshot.phone})` : ''}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="font-semibold">Order Type:</span>
              <span className="font-bold capitalize flex items-center gap-1">
                {order.orderType === 'delivery' ? (
                  <>
                    <Truck className="w-3.5 h-3.5 text-purple-600" />
                    <span className="text-purple-700">Delivery</span>
                  </>
                ) : (
                  <>
                    <ShoppingBag className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-amber-700">Takeaway</span>
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="font-semibold">Total Amount:</span>
              <span className="font-black text-slate-900">
                {formatMoney(order.grandTotalMinor, symbol)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200/60">
              <span className="font-semibold">Items ({order.items?.length || 0}):</span>
              <span className="text-slate-600 truncate max-w-[240px]">
                {order.items?.map((i) => `${i.quantity}x ${i.nameSnapshot}`).join(', ')}
              </span>
            </div>
          </div>

          {/* Prep Time Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-indigo-600" />
              Estimated Kitchen Prep Time
            </label>
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2 mb-2.5">
              {PRESET_PREP_TIMES.map((mins) => {
                const isSelected = !isCustom && selectedPrepTime === mins;
                return (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => handlePresetClick(mins)}
                    className={`h-9 sm:h-10 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-bold transition-all border ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/30 ring-2 ring-indigo-600/20'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {mins}m
                  </button>
                );
              })}
            </div>

            {/* Custom Input Option */}
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setIsCustom(true);
                  if (!customPrepTime) setCustomPrepTime('25');
                }}
                className={`h-8 px-2.5 rounded-lg text-[10px] sm:text-xs font-semibold border transition-all ${
                  isCustom
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                    : 'bg-slate-100 text-slate-600 border-transparent hover:bg-slate-200'
                }`}
              >
                Custom minutes:
              </button>
              {isCustom && (
                <div className="flex items-center gap-1.5 flex-1">
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={customPrepTime}
                    onChange={handleCustomChange}
                    placeholder="e.g. 25"
                    className="w-20 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-indigo-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    autoFocus
                  />
                  <span className="text-[10px] sm:text-xs text-slate-500 font-medium">minutes</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-10 w-full px-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 text-[11px] sm:text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              id="confirm-accept-online-order-btn"
              className="h-10 w-full px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] sm:text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Accepting Order...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Accept & Send to Kitchen ({isCustom ? (customPrepTime || selectedPrepTime) : selectedPrepTime}m)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
