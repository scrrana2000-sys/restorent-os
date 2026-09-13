import React from 'react';
import {
  MatchedItemResult,
  AmbiguousMatchResult,
  UnmatchedResult,
  VoiceActionType
} from '../../services/voice/voiceTypes';
import { MenuItem } from '../../types/menu';
import { formatMoney, toMoneyMinor } from '../../utils/money';
import {
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Plus,
  Minus,
  Trash2,
  Utensils,
  Search,
  RotateCcw
} from 'lucide-react';

interface VoiceMatchPreviewProps {
  matchedItems: MatchedItemResult[];
  ambiguousItems: AmbiguousMatchResult[];
  unmatchedItems: UnmatchedResult[];
  overallAction: VoiceActionType;
  currencySymbol?: string;
  onUpdateQuantity: (index: number, newQty: number) => void;
  onRemoveMatchedItem: (index: number) => void;
  onResolveAmbiguity: (ambiguityIndex: number, selectedItem: MenuItem) => void;
  onSpeakAgain: () => void;
}

export const VoiceMatchPreview: React.FC<VoiceMatchPreviewProps> = ({
  matchedItems,
  ambiguousItems,
  unmatchedItems,
  overallAction,
  currencySymbol = '₹',
  onUpdateQuantity,
  onRemoveMatchedItem,
  onResolveAmbiguity,
  onSpeakAgain
}) => {
  const hasContent =
    matchedItems.length > 0 ||
    ambiguousItems.length > 0 ||
    unmatchedItems.length > 0 ||
    overallAction === 'CLEAR_CART';

  if (!hasContent) {
    return (
      <div className="text-center py-6 px-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
        <div className="w-12 h-12 mx-auto mb-2 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <Utensils className="w-6 h-6" />
        </div>
        <p className="text-xs sm:text-sm font-semibold text-slate-700">No items detected yet</p>
        <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
          Try saying: &ldquo;2 veg biryani aur 1 coke&rdquo; or &ldquo;ek butter chicken aur do naan&rdquo;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 1. Clear Cart Intent Banner */}
      {overallAction === 'CLEAR_CART' && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-rose-900">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <div className="text-xs sm:text-sm font-semibold">
            Action: <span className="font-bold">Clear entire cart</span>. Confirmation required.
          </div>
        </div>
      )}

      {/* 2. Matched Items List */}
      {matchedItems.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Matched Menu Items ({matchedItems.length})</span>
          </div>

          <div className="space-y-1.5">
            {matchedItems.map((matched, idx) => {
              const item = matched.menuItem;
              const isVeg = item.foodType === 'veg';
              const priceMinor = toMoneyMinor(item.price);

              return (
                <div
                  key={`matched_${item.itemId}_${idx}`}
                  className="flex items-center justify-between p-2.5 sm:p-3 bg-white border border-slate-200 rounded-xl shadow-2xs hover:border-indigo-200 transition-all gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Food Type Indicator */}
                    <span
                      className={`w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 ${
                        isVeg ? 'border-emerald-600' : 'border-rose-600'
                      }`}
                      title={isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isVeg ? 'bg-emerald-600' : 'bg-rose-600'
                        }`}
                      />
                    </span>

                    <div className="min-w-0">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                        {item.name}
                      </h4>
                      <p className="text-[11px] font-semibold text-indigo-600">
                        {formatMoney(priceMinor, currencySymbol)}
                        {matched.matchType === 'FUZZY' && (
                          <span className="ml-1.5 text-[10px] text-amber-600 font-medium">
                            (Approx match)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Quantity Stepper & Remove */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(idx, matched.quantity - 1)}
                        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white text-slate-700 active:scale-95 transition-all min-h-[32px] min-w-[32px]"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-7 text-center font-bold text-xs text-slate-900">
                        {matched.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(idx, matched.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white text-slate-700 active:scale-95 transition-all min-h-[32px] min-w-[32px]"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemoveMatchedItem(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                      title="Remove"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Ambiguous Items (Requires Clarification) */}
      {ambiguousItems.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
            <HelpCircle className="w-4 h-4 text-amber-600" />
            <span>Which one did you mean? ({ambiguousItems.length})</span>
          </div>

          <div className="space-y-2">
            {ambiguousItems.map((ambiguous, ambIdx) => (
              <div
                key={`amb_${ambIdx}`}
                className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2"
              >
                <p className="text-xs font-semibold text-amber-900">
                  You said &ldquo;<span className="font-bold">{ambiguous.rawQuery}</span>&rdquo; (Qty: {ambiguous.quantity}). Please select the exact item:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {ambiguous.candidates.map((candidate) => (
                    <button
                      key={`candidate_${candidate.itemId}`}
                      type="button"
                      onClick={() => onResolveAmbiguity(ambIdx, candidate)}
                      className="flex items-center justify-between p-2 rounded-lg bg-white border border-amber-300 hover:border-indigo-600 hover:bg-indigo-50/50 text-left transition-all active:scale-98 min-h-[44px]"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {candidate.name}
                        </p>
                        <p className="text-[11px] font-semibold text-indigo-600">
                          {formatMoney(toMoneyMinor(candidate.price), currencySymbol)}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-indigo-600 px-2 py-0.5 rounded bg-indigo-50 shrink-0 ml-1">
                        Select
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Unmatched Items */}
      {unmatchedItems.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>Not Found in Menu ({unmatchedItems.length})</span>
          </div>

          <div className="space-y-1.5">
            {unmatchedItems.map((unmatched, unIdx) => (
              <div
                key={`unmatched_${unIdx}`}
                className="flex items-center justify-between p-2.5 bg-rose-50/60 border border-rose-200 rounded-xl gap-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-rose-900 truncate">
                    &ldquo;<span className="font-bold">{unmatched.rawQuery}</span>&rdquo; menu mein nahi mila.
                  </p>
                  <p className="text-[11px] text-rose-700">
                    Check spelling or search from the menu list.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onSpeakAgain}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 text-xs font-bold shrink-0 min-h-[36px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Try Again</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
