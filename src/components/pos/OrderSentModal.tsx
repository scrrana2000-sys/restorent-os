import React, { useEffect } from 'react';
import { CheckCircle2, CookingPot, Utensils, ShoppingBag, Truck, Printer, Plus } from 'lucide-react';
import { Order } from '../../types/order';
import { KOT } from '../../types/kot';

interface OrderSentModalProps {
  isOpen: boolean;
  order: Order | null;
  kot: KOT | null;
  tableName?: string | null;
  onClose: () => void;
  onViewBill: (order: Order) => void;
}

export const OrderSentModal: React.FC<OrderSentModalProps> = ({
  isOpen,
  order,
  kot,
  tableName,
  onClose,
  onViewBill
}) => {
  // Auto-dismiss after 2 seconds so low-literacy staff can immediately continue
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      onClose();
    }, 2000);
    return () => clearTimeout(timer);
  }, [isOpen, onClose]);

  if (!isOpen || !order || !kot) return null;

  const orderType = order.orderType;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-xs w-full p-5 shadow-2xl border border-slate-200 flex flex-col items-center text-center space-y-3 animate-in zoom-in-95 duration-150">
        {/* Animated Large Green Checkmark */}
        <div className="w-16 h-16 rounded-full bg-emerald-100 border-4 border-emerald-400 flex items-center justify-center text-emerald-600 shadow-lg shadow-emerald-500/25">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        {/* Clear Big Headline for Low Literacy */}
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight leading-tight uppercase">
            ORDER SENT TO KITCHEN
          </h2>
          <div className="mt-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black">
            {orderType === 'dineIn' ? (
              <>
                <Utensils className="w-3.5 h-3.5 text-emerald-600" />
                <span>{tableName || `Table ${order.tableId || ''}`}</span>
              </>
            ) : orderType === 'takeaway' ? (
              <>
                <ShoppingBag className="w-3.5 h-3.5 text-amber-600" />
                <span>Parcel</span>
              </>
            ) : (
              <>
                <Truck className="w-3.5 h-3.5 text-purple-600" />
                <span>Delivery</span>
              </>
            )}
            <span className="text-slate-400">•</span>
            <span>KOT #{kot.kotNumber}</span>
          </div>
        </div>

        {/* Fast Action Buttons */}
        <div className="w-full space-y-2 pt-1">
          <button
            type="button"
            id="order-sent-take-next-btn"
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>NEW ORDER</span>
          </button>

          <button
            type="button"
            id="order-sent-view-bill-btn"
            onClick={() => {
              onClose();
              onViewBill(order);
            }}
            className="w-full py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition-all min-h-[36px]"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
