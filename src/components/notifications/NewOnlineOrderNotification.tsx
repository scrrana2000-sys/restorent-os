import React from 'react';
import { Order } from '../../types/order';
import { formatMoney } from '../../utils/money';
import { Bell, X, ExternalLink, ShoppingBag, Truck, Volume2, VolumeX, CheckCircle } from 'lucide-react';

export interface NewOnlineOrderNotificationProps {
  orders: Order[];
  onDismiss: (orderId: string) => void;
  onDismissAll: () => void;
  onViewOrder: (order: Order) => void;
  currencySymbol?: string;
  isSoundEnabled?: boolean;
  onToggleSound?: () => void;
}

export const NewOnlineOrderNotification: React.FC<NewOnlineOrderNotificationProps> = ({
  orders,
  onDismiss,
  onDismissAll,
  onViewOrder,
  currencySymbol = '₹',
  isSoundEnabled = true,
  onToggleSound
}) => {
  if (!orders || orders.length === 0) return null;

  return (
    <div
      id="new-online-orders-notification-container"
      className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm sm:max-w-md w-full pointer-events-none px-3 sm:px-0"
    >
      {/* Multi-order banner when more than 1 notification is active */}
      {orders.length > 1 && (
        <div
          id="multi-online-orders-header"
          className="pointer-events-auto bg-slate-900/95 text-white backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-xl flex items-center justify-between border border-slate-800 text-xs animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-bold">
              {orders.length} New Online Orders Waiting
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onToggleSound && (
              <button
                type="button"
                onClick={onToggleSound}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title={isSoundEnabled ? 'Mute sound alerts' : 'Enable sound alerts'}
              >
                {isSoundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-amber-400" />}
              </button>
            )}
            <button
              id="btn-dismiss-all-online-orders"
              type="button"
              onClick={onDismissAll}
              className="text-[11px] font-semibold text-slate-300 hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
            >
              Dismiss All
            </button>
          </div>
        </div>
      )}

      {/* Individual Order Notification Cards (Showing up to 3 most recent) */}
      {orders.slice(0, 3).map((order) => {
        const customerName = order.customerSnapshot?.name?.trim() || 'Guest Customer';
        const isDelivery = order.orderType === 'delivery';

        return (
          <div
            key={order.id}
            id={`new-online-order-card-${order.id}`}
            className="pointer-events-auto bg-white border-2 border-emerald-500/80 rounded-2xl shadow-2xl p-4 transition-all duration-200 animate-in fade-in slide-in-from-top-4 duration-300 relative overflow-hidden"
          >
            {/* Top Accent Strip */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600" />

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 shadow-xs">
                  <Bell className="w-4 h-4 animate-bounce" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black tracking-wider text-emerald-700 uppercase">
                      NEW ONLINE ORDER
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      {isDelivery ? (
                        <>
                          <Truck className="w-3 h-3 mr-1 text-sky-600" />
                          Delivery
                        </>
                      ) : (
                        <>
                          <ShoppingBag className="w-3 h-3 mr-1 text-amber-600" />
                          Takeaway
                        </>
                      )}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-medium">Received just now</span>
                </div>
              </div>

              {/* Dismiss button */}
              <button
                id={`btn-dismiss-online-order-${order.id}`}
                type="button"
                onClick={() => onDismiss(order.id)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                aria-label="Dismiss notification"
                title="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Order Details Body */}
            <div className="mt-3.5 grid grid-cols-2 gap-2 bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs">
              <div>
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">
                  Order Number
                </span>
                <span className="font-extrabold text-slate-900 text-sm">
                  {order.orderNumber || order.id.substring(0, 8)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">
                  Amount
                </span>
                <span className="font-black text-slate-900 text-sm">
                  {formatMoney(order.grandTotalMinor || 0, currencySymbol)}
                </span>
              </div>
              <div className="col-span-2 pt-1 border-t border-slate-200/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-600 block">Customer</span>
                  <span className="font-semibold text-slate-800 truncate block max-w-[180px]">
                    {customerName}
                  </span>
                </div>
                {order.items && order.items.length > 0 && (
                  <span className="text-[11px] font-medium text-slate-500">
                    {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-3.5 flex items-center gap-2">
              <button
                id={`btn-view-online-order-${order.id}`}
                type="button"
                onClick={() => onViewOrder(order)}
                className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>VIEW ORDER</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                id={`btn-ack-online-order-${order.id}`}
                type="button"
                onClick={() => onDismiss(order.id)}
                className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1"
              >
                <CheckCircle className="w-3.5 h-3.5 text-slate-600" />
                <span>Dismiss</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
