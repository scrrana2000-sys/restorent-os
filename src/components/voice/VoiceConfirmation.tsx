import React from 'react';
import { MatchedItemResult, VoiceActionType } from '../../services/voice/voiceTypes';
import { formatMoney, toMoneyMinor } from '../../utils/money';
import { MoneyMinor } from '../../types/money';
import { ShoppingCart, Check, X, RotateCcw, AlertTriangle } from 'lucide-react';

interface VoiceConfirmationProps {
  matchedItems: MatchedItemResult[];
  overallAction: VoiceActionType;
  currencySymbol?: string;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSpeakMore: () => void;
}

export const VoiceConfirmation: React.FC<VoiceConfirmationProps> = ({
  matchedItems,
  overallAction,
  currencySymbol = '₹',
  isSubmitting = false,
  onConfirm,
  onCancel,
  onSpeakMore
}) => {
  if (overallAction === 'CLEAR_CART') {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-3">
        <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>Confirm Cart Clear</span>
        </div>
        <p className="text-xs text-rose-700 leading-relaxed">
          Are you sure you want to remove all items from your current cart?
        </p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs min-h-[44px]"
          >
            Yes, Clear Cart
          </button>
        </div>
      </div>
    );
  }

  if (matchedItems.length === 0) {
    return null;
  }

  // Calculate estimated subtotal
  const estimatedTotalMinor: MoneyMinor = matchedItems.reduce((sum, m) => {
    const unitPrice = toMoneyMinor(m.menuItem.price);
    return (sum + unitPrice * m.quantity) as MoneyMinor;
  }, 0 as MoneyMinor);

  const totalItemCount = matchedItems.reduce((sum, m) => sum + m.quantity, 0);

  return (
    <div className="p-3.5 sm:p-4 bg-indigo-50/60 border border-indigo-200 rounded-2xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
          Order Summary ({totalItemCount} items)
        </div>
        <div className="text-sm font-black text-indigo-900">
          Estimated: {formatMoney(estimatedTotalMinor, currencySymbol)}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={onSpeakMore}
          disabled={isSubmitting}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 active:scale-95 transition-all min-h-[44px]"
        >
          <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
          <span>Speak More</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-xl transition-all min-h-[44px]"
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </button>

          <button
            type="button"
            id="voice-confirm-add-btn"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 rounded-xl shadow-md shadow-indigo-200 transition-all min-h-[44px]"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>{isSubmitting ? 'Adding...' : 'Add to Cart'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
