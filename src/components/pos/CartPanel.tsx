import React, { useState, useMemo } from 'react';
import { CartItem } from '../../types/cart';
import { OrderType } from '../../types/order';
import { Table, TableSession } from '../../types/table';
import { DiscountSpec } from '../../types/discount';
import { calculateOrderTotals } from '../../services/orderCalculationService';
import { formatMoney } from '../../utils/money';
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  MessageSquare,
  Tag,
  CreditCard,
  PauseCircle,
  Flame,
  Utensils,
  Truck,
  Check
} from 'lucide-react';

interface CartPanelProps {
  cartItems: CartItem[];
  orderType: OrderType;
  selectedTable: Table | null;
  activeSession: TableSession | null;
  orderDiscount?: DiscountSpec;
  orderNotes?: string;
  onOrderNotesChange?: (notes: string) => void;
  onUpdateQuantity: (cartItemId: string, newQuantity: number) => void;
  onRemoveItem: (cartItemId: string) => void;
  onUpdateItemNotes: (cartItemId: string, notes: string) => void;
  onClearCart: () => void;
  onApplyDiscount: (discount?: DiscountSpec) => void;
  onHoldOrder: () => void;
  onCreateKot: () => void;
  onOpenPayment: () => void;
  isSubmitting?: boolean;
  symbol?: string;
  onCloseTable?: () => void;
}

export const CartPanel: React.FC<CartPanelProps> = ({
  cartItems,
  orderType,
  selectedTable,
  activeSession,
  orderDiscount,
  orderNotes = '',
  onUpdateQuantity,
  onRemoveItem,
  onUpdateItemNotes,
  onClearCart,
  onApplyDiscount,
  onHoldOrder,
  onCreateKot,
  onOpenPayment,
  isSubmitting = false,
  symbol = '₹',
  onCloseTable
}) => {
  const [editingNotesItemId, setEditingNotesItemId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(0);

  // Authoritative totals calculation via calculation service
  const calculationResult = useMemo(() => {
    if (cartItems.length === 0) {
      return {
        lineResults: [],
        subtotalMinor: 0,
        discountMinor: 0,
        taxableAmountMinor: 0,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
        totalTaxMinor: 0,
        grandTotalMinor: 0,
        roundingAdjustmentMinor: 0
      };
    }

    const lineInputs = cartItems.map((item) => ({
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      taxRate: item.taxRate,
      taxInclusive: item.taxInclusive
    }));

    return calculateOrderTotals({
      items: lineInputs,
      orderDiscount
    });
  }, [cartItems, orderDiscount]);

  const totalQuantity = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.quantity, 0);
  }, [cartItems]);

  const handleSaveItemNote = (cartItemId: string) => {
    onUpdateItemNotes(cartItemId, noteInput);
    setEditingNotesItemId(null);
    setNoteInput('');
  };

  const handleApplyDiscountSubmit = () => {
    if (discountValue <= 0) {
      onApplyDiscount(undefined);
    } else {
      if (discountType === 'percent') {
        onApplyDiscount({ type: 'percentage', percentageRate: Math.min(100, Math.max(0, discountValue)) });
      } else {
        onApplyDiscount({ type: 'fixed', fixedAmountMinor: Math.max(0, Math.round(discountValue * 100)) });
      }
    }
    setShowDiscountModal(false);
  };

  return (
    <div className="bg-white border-l border-slate-200 h-full flex flex-col justify-between shadow-xs select-none">
      {/* Top Cart Order Slip Header */}
      <div className="px-3 py-2 sm:py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
        <div>
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="w-3.5 h-3.5 text-indigo-600" />
            <h3 className="text-xs font-black text-slate-900 tracking-tight">Order Sheet</h3>
            <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded-full">
              {totalQuantity} {totalQuantity === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
            <span className="inline-flex items-center gap-1 font-bold text-slate-700">
              {orderType === 'dineIn' ? (
                <>
                  <Utensils className="w-3 h-3 text-indigo-600" />
                  <span>{selectedTable ? `Table ${selectedTable.tableNumber}` : 'No Table'}</span>
                </>
              ) : orderType === 'takeaway' ? (
                <>
                  <ShoppingBag className="w-3 h-3 text-amber-600" />
                  <span>Parcel</span>
                </>
              ) : (
                <>
                  <Truck className="w-3 h-3 text-purple-600" />
                  <span>Delivery</span>
                </>
              )}
            </span>

            {orderType === 'dineIn' && selectedTable && (selectedTable.activeSessionId || activeSession) && onCloseTable && (
              <button
                type="button"
                onClick={onCloseTable}
                disabled={isSubmitting}
                className="ml-1 px-1.5 py-0.2 text-[9px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors"
                title="Close Table Session"
              >
                Close Table
              </button>
            )}
          </div>
        </div>

        {cartItems.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Clear all items from current cart?')) {
                onClearCart();
              }
            }}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors active:scale-95"
            title="Clear Cart"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Middle Cart Item List — Compact Receipt Style */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {cartItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-slate-700">Order is empty</p>
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-[160px]">
              Tap any food tile to add items.
            </p>
          </div>
        ) : (
          cartItems.map((item, idx) => {
            const lineRes = calculationResult?.lineResults[idx];
            const isEditingNote = editingNotesItemId === item.cartItemId;

            return (
              <div
                key={item.cartItemId}
                className="py-1.5 border-b border-slate-100 last:border-b-0 space-y-1 text-xs"
              >
                {/* Main line: Item Name, Stepper, Price */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-extrabold text-xs text-slate-900 block truncate">
                      {item.nameSnapshot}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium block truncate">
                      {formatMoney(item.unitPriceMinor, symbol)}
                    </span>
                  </div>

                  {/* Compact Stepper [ - ] Qty [ + ] */}
                  <div className="flex items-center bg-slate-100 rounded-lg p-0.5 shrink-0">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => onUpdateQuantity(item.cartItemId, item.quantity - 1)}
                      className="w-6 h-6 rounded flex items-center justify-center bg-white text-slate-700 font-bold active:scale-90 hover:bg-slate-50 shadow-2xs"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-5 text-center font-black text-xs text-slate-900">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => onUpdateQuantity(item.cartItemId, item.quantity + 1)}
                      className="w-6 h-6 rounded flex items-center justify-center bg-indigo-600 text-white font-bold active:scale-90 shadow-2xs"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Line Total */}
                  <div className="text-right shrink-0 min-w-[50px]">
                    <span className="font-black text-xs text-slate-900 block">
                      {lineRes
                        ? formatMoney(lineRes.lineTotalMinor, symbol)
                        : formatMoney(item.unitPriceMinor * item.quantity, symbol)}
                    </span>
                  </div>
                </div>

                {/* Item Kitchen Note */}
                {isEditingNote ? (
                  <div className="flex items-center gap-1 pt-0.5">
                    <input
                      type="text"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Note for kitchen..."
                      className="flex-1 px-2 py-1 text-[11px] bg-white border border-indigo-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveItemNote(item.cartItemId)}
                      className="px-2 py-1 bg-indigo-600 text-white font-bold text-[10px] rounded-md"
                    >
                      OK
                    </button>
                  </div>
                ) : item.notes ? (
                  <div className="flex items-center justify-between text-[10px] text-amber-800 bg-amber-50/80 px-1.5 py-0.5 rounded">
                    <span className="truncate">📝 {item.notes}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNotesItemId(item.cartItemId);
                        setNoteInput(item.notes || '');
                      }}
                      className="text-amber-900 underline text-[9px] ml-1"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNotesItemId(item.cartItemId);
                      setNoteInput('');
                    }}
                    className="text-[10px] text-slate-400 hover:text-indigo-600 inline-flex items-center gap-0.5 py-0.2"
                  >
                    <MessageSquare className="w-2.5 h-2.5" />
                    <span>+ note</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Slip Totals & Actions */}
      {cartItems.length > 0 && (
        <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 space-y-1.5 shrink-0">
          {/* Breakdown Table */}
          <div className="bg-white border border-slate-200 rounded-xl p-2 space-y-1 text-xs shadow-2xs">
            <div className="flex justify-between text-slate-600 text-[11px]">
              <span>Subtotal</span>
              <span className="font-semibold text-slate-900">
                {formatMoney(calculationResult.subtotalMinor, symbol)}
              </span>
            </div>

            {calculationResult.discountMinor > 0 && (
              <div className="flex justify-between text-emerald-700 font-bold text-[11px]">
                <span>Discount</span>
                <span>-{formatMoney(calculationResult.discountMinor, symbol)}</span>
              </div>
            )}

            <div className="flex justify-between text-slate-500 text-[10px]">
              <span>Taxes (GST)</span>
              <span>{formatMoney(calculationResult.totalTaxMinor, symbol)}</span>
            </div>

            <div className="pt-1 border-t border-slate-100 flex justify-between items-center text-xs">
              <span className="font-black text-slate-900">Total</span>
              <span className="font-black text-indigo-700 text-sm">
                {formatMoney(calculationResult.grandTotalMinor, symbol)}
              </span>
            </div>
          </div>

          {/* PRIMARY ACTION: SEND TO KITCHEN */}
          <div className="space-y-1.5 pt-0.5">
            <button
              id="pos-send-to-kitchen-btn"
              type="button"
              disabled={isSubmitting}
              onClick={onCreateKot}
              className="w-full h-11 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-black text-sm transition-all shadow-md shadow-amber-500/20 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Flame className="w-4 h-4 text-red-600 fill-red-600" />
              <span>SEND TO KITCHEN</span>
            </button>

            {/* Secondary Actions: Hold & Settle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onHoldOrder}
                className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs active:scale-95 disabled:opacity-50 transition-colors"
              >
                <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                <span>Hold</span>
              </button>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={onOpenPayment}
                className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-2xs active:scale-95 disabled:opacity-50 transition-colors"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Pay & Settle</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discount Modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 max-w-xs w-full shadow-2xl space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Apply Order Discount</h3>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDiscountType('percent')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg border ${
                  discountType === 'percent'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                % Percent
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('fixed')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg border ${
                  discountType === 'fixed'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                Fixed ({symbol})
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">
                {discountType === 'percent' ? 'Percentage' : `Amount (${symbol})`}
              </label>
              <input
                type="number"
                min="0"
                step={discountType === 'percent' ? '1' : '10'}
                value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDiscountModal(false)}
                className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyDiscountSubmit}
                className="px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-2xs"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
