import React, { useState, useMemo } from 'react';
import { X, AlertTriangle, XCircle, Check, Minus, Plus, RefreshCw, Layers } from 'lucide-react';
import { KOT, KOTItem } from '../../types/kot';

interface AdjustKotItemsModalProps {
  isOpen: boolean;
  kot: KOT | null;
  tableName?: string | null;
  orderNumber?: string | null;
  onClose: () => void;
  onConfirmPartialCancel: (
    cancellations: { itemId: string; cancelledQuantity: number; reason: string }[]
  ) => void;
  onConfirmFullCancel: (reason: string) => void;
  isSubmitting?: boolean;
}

const PRESET_REASONS = [
  'Item Out of Stock / Low Stock',
  'Customer Cancelled Item',
  'Kitchen Overcapacity / Delay',
  'Incorrect Item Ordered'
];

export const AdjustKotItemsModal: React.FC<AdjustKotItemsModalProps> = ({
  isOpen,
  kot,
  tableName,
  orderNumber,
  onClose,
  onConfirmPartialCancel,
  onConfirmFullCancel,
  isSubmitting = false
}) => {
  const [cancelMode, setCancelMode] = useState<'partial' | 'full'>('partial');
  // Map of itemId -> cancelledQuantity
  const [cancelQuantities, setCancelQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<string>('Item Out of Stock / Low Stock');
  const [customReason, setCustomReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Initialize or reset cancel quantities when kot changes
  React.useEffect(() => {
    if (kot) {
      setCancelQuantities({});
      setReason('Item Out of Stock / Low Stock');
      setCustomReason('');
      setError(null);
      setCancelMode('partial');
    }
  }, [kot]);

  if (!isOpen || !kot) return null;

  const activeItems = kot.items.filter((item) => item.quantity > 0);

  const handleQtyChange = (itemId: string, maxQty: number, delta: number) => {
    setCancelQuantities((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, Math.min(maxQty, current + delta));
      return { ...prev, [itemId]: next };
    });
    if (error) setError(null);
  };

  const handleSetExactQty = (itemId: string, maxQty: number, target: number) => {
    const valid = isNaN(target) ? 0 : Math.max(0, Math.min(maxQty, Math.floor(target)));
    setCancelQuantities((prev) => ({ ...prev, [itemId]: valid }));
    if (error) setError(null);
  };

  const totalCancelledItemsCount = (Object.values(cancelQuantities) as number[]).reduce((a, b) => a + b, 0);
  const totalActiveItemsCount = activeItems.reduce((a, b) => a + b.quantity, 0);
  const isEveryItemCancelled =
    activeItems.length > 0 &&
    activeItems.every((item) => (cancelQuantities[item.itemId] || 0) === item.quantity);

  const finalReason = customReason.trim() ? customReason.trim() : reason;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalReason) {
      setError('Please select or specify a cancellation reason.');
      return;
    }

    if (cancelMode === 'full' || isEveryItemCancelled) {
      onConfirmFullCancel(finalReason);
      return;
    }

    if (totalCancelledItemsCount === 0) {
      setError('Please specify a quantity to cancel for at least one item.');
      return;
    }

    const cancellations = activeItems
      .filter((item) => (cancelQuantities[item.itemId] || 0) > 0)
      .map((item) => ({
        itemId: item.itemId,
        cancelledQuantity: cancelQuantities[item.itemId],
        reason: finalReason
      }));

    onConfirmPartialCancel(cancellations);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-6 text-white shadow-2xl relative animate-in slide-in-from-bottom sm:zoom-in duration-200 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white">Adjust & Cancel Items</h3>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                  {kot.kotNumber}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {tableName ? `Table: ${tableName}` : 'Kitchen Ticket'}{' '}
                {orderNumber ? `• Ref: ${orderNumber}` : ''}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 gap-2 my-3 p-1 rounded-xl bg-slate-800/80 border border-slate-700/60">
          <button
            type="button"
            onClick={() => setCancelMode('partial')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              cancelMode === 'partial'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Partial Item / Qty Cancellation
          </button>
          <button
            type="button"
            onClick={() => setCancelMode('full')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              cancelMode === 'full'
                ? 'bg-rose-600 text-white shadow-md font-black'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Cancel Entire KOT
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-4 pr-1">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-medium flex items-center gap-2">
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {cancelMode === 'partial' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
                <span>Select quantity to cancel for each item:</span>
                <span className="font-mono text-amber-300">
                  {totalCancelledItemsCount} of {totalActiveItemsCount} items selected
                </span>
              </div>

              <div className="space-y-2.5">
                {activeItems.map((item) => {
                  const toCancel = cancelQuantities[item.itemId] || 0;
                  const remaining = item.quantity - toCancel;

                  return (
                    <div
                      key={item.itemId}
                      className={`p-3 rounded-xl border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        toCancel > 0
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : 'bg-slate-800/60 border-slate-700/60'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {item.quantity}x
                          </span>
                          <span className="font-bold text-sm text-white truncate">
                            {item.shortNameSnapshot || item.nameSnapshot}
                          </span>
                        </div>
                        {item.originalQuantity && item.originalQuantity > item.quantity && (
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Original: {item.originalQuantity}x (Already cancelled:{' '}
                            {item.cancelledQuantity || 0}x)
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-emerald-400 font-semibold">
                            Keep: {remaining}
                          </span>
                          <span className="text-slate-500">•</span>
                          <span
                            className={toCancel > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}
                          >
                            Cancel: {toCancel}
                          </span>
                        </div>
                      </div>

                      {/* Stepper Controls */}
                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleQtyChange(item.itemId, item.quantity, -1)}
                          disabled={toCancel <= 0 || isSubmitting}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center border border-slate-700 transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>

                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={toCancel}
                          onChange={(e) =>
                            handleSetExactQty(item.itemId, item.quantity, parseInt(e.target.value, 10))
                          }
                          className="w-12 h-8 rounded-lg bg-slate-900 border border-slate-700 text-center text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                        />

                        <button
                          type="button"
                          onClick={() => handleQtyChange(item.itemId, item.quantity, 1)}
                          disabled={toCancel >= item.quantity || isSubmitting}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center border border-slate-700 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSetExactQty(item.itemId, item.quantity, item.quantity)}
                          disabled={toCancel === item.quantity || isSubmitting}
                          className="px-2 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 border border-slate-700 ml-1 transition-colors"
                        >
                          All
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-2">
              <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <span>Entire KOT will be cancelled</span>
              </div>
              <p className="text-xs text-slate-300">
                All {totalActiveItemsCount} active items in {kot.kotNumber} will be cancelled. Stock
                will be reversed to the inventory ledger, and order totals will be updated
                accordingly.
              </p>
            </div>
          )}

          {/* Reason Selection */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="block text-xs font-bold text-slate-300">
              Cancellation Reason *
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setReason(r);
                    setCustomReason('');
                    if (error) setError(null);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    reason === r && !customReason
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={customReason}
              onChange={(e) => {
                setCustomReason(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Or enter custom reason..."
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-amber-500 mt-1 min-h-[38px]"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                (cancelMode === 'partial' && totalCancelledItemsCount === 0)
              }
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50 min-h-[44px] flex items-center gap-2 ${
                cancelMode === 'full' || isEveryItemCancelled
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/40'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-950/40'
              }`}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : cancelMode === 'full' || isEveryItemCancelled ? (
                <span>Confirm Full Cancellation</span>
              ) : (
                <span>Confirm Cancellation ({totalCancelledItemsCount} Items)</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
