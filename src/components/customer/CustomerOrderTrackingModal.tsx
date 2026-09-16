import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Clock,
  MapPin,
  FileText,
  ShoppingBag,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Receipt,
  Radio,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { Order } from '../../types/order';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { OrderStatusTimeline } from './OrderStatusTimeline';
import {
  getOrderForTracking,
  subscribeToOrderTracking
} from '../../services/customerOrderTrackingService';
import { formatMoney } from '../../utils/money';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { buildPublicUrl } from '../../utils/urlUtils';

export interface CustomerOrderTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId?: string;
  orderId?: string;
  initialOrder?: Order | null;
  onBackToMenu?: () => void;
}

export const CustomerOrderTrackingModal: React.FC<CustomerOrderTrackingModalProps> = ({
  isOpen,
  onClose,
  restaurantId: propRestaurantId,
  orderId: propOrderId,
  initialOrder,
  onBackToMenu
}) => {
  const { customer, firebaseUser } = useCustomerAuth();
  const currentUid = customer?.customerId || firebaseUser?.uid || null;

  const [order, setOrder] = useState<Order | null>(initialOrder || null);
  const [isLoading, setIsLoading] = useState<boolean>(!initialOrder);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLiveActive, setIsLiveActive] = useState<boolean>(true);

  const effectiveRestaurantId = propRestaurantId || initialOrder?.restaurantId;
  const effectiveOrderId = propOrderId || initialOrder?.id;

  // Realtime subscription setup
  useEffect(() => {
    if (!isOpen || !effectiveRestaurantId || !effectiveOrderId) {
      return;
    }

    let isMounted = true;
    setIsLoading(!order);
    setErrorMessage(null);

    // 1. Initial direct fetch for immediate display
    getOrderForTracking(effectiveRestaurantId, effectiveOrderId, currentUid)
      .then((loadedOrder) => {
        if (isMounted) {
          setOrder(loadedOrder);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.warn('[CustomerOrderTracking] Initial load notice:', err);
          // If we already have initialOrder, keep it
          if (!order) {
            setErrorMessage(err?.message || 'Could not load order details.');
            setIsLoading(false);
          }
        }
      });

    // 2. Realtime listener
    const unsubscribe = subscribeToOrderTracking(
      effectiveRestaurantId,
      effectiveOrderId,
      (updatedOrder) => {
        if (isMounted) {
          setOrder(updatedOrder);
          setIsLoading(false);
          setErrorMessage(null);
          setIsLiveActive(true);
        }
      },
      (err) => {
        if (isMounted) {
          console.warn('[CustomerOrderTracking] Listener warning:', err.message);
          setIsLiveActive(false);
        }
      },
      currentUid
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isOpen, effectiveRestaurantId, effectiveOrderId, currentUid]);

  // Back button handling
  useModalBackHandler(isOpen, onClose, 'customer-order-tracking-modal');

  if (!isOpen) return null;

  const handleOpenInvoice = () => {
    if (!order) return;
    const url = buildPublicUrl(`?bill=${order.id}&rest=${order.restaurantId}`);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      id="customer-order-tracking-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="customer-order-tracking-modal-card"
        className="bg-white rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200/80 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              id="tracking-back-btn"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-200/60 transition-colors shrink-0"
              title="Close Tracking"
            >
              <ArrowLeft className="w-5 h-5 text-slate-700" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="tracking-modal-order-number" className="text-sm sm:text-base font-extrabold text-slate-900 truncate">
                  {order ? `Order #${order.orderNumber || order.id}` : 'Order Tracking'}
                </h2>
                {isLiveActive && order && order.status !== 'completed' && order.status !== 'cancelled' && (
                  <span
                    id="tracking-live-indicator"
                    className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full shrink-0"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Live</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {order?.orderType ? `${order.orderType.toUpperCase()} ORDER` : 'ONLINE ORDER'}
              </p>
            </div>
          </div>

          <button
            id="close-tracking-modal-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {isLoading && !order && (
            <div id="tracking-loading-state" className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader2 className="w-8 h-8 text-orange-600 animate-spin" />
              <span className="text-xs font-semibold text-slate-500">Connecting to live order status...</span>
            </div>
          )}

          {errorMessage && !order && (
            <div id="tracking-error-state" className="p-4 bg-red-50 border border-red-200 rounded-2xl space-y-2 text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
              <h4 className="text-xs font-bold text-red-900">Unable to load order</h4>
              <p className="text-[11px] text-red-700">{errorMessage}</p>
              <button
                type="button"
                onClick={() => {
                  setIsLoading(true);
                  setErrorMessage(null);
                  if (effectiveRestaurantId && effectiveOrderId) {
                    getOrderForTracking(effectiveRestaurantId, effectiveOrderId, currentUid)
                      .then(setOrder)
                      .catch((e) => setErrorMessage(e.message))
                      .finally(() => setIsLoading(false));
                  }
                }}
                className="mt-2 px-3 py-1.5 bg-red-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          {order && (
            <>
              {/* Order Status Timeline Component */}
              <OrderStatusTimeline
                status={order.status}
                orderType={order.orderType}
                placedAt={order.createdAt}
                updatedAt={order.updatedAt}
                estimatedPrepMinutes={(order as any).estimatedPrepMinutes}
                cancellationReason={order.cancellationReason || undefined}
              />

              {/* Delivery Address (if applicable) */}
              {order.orderType === 'delivery' && order.customerSnapshot?.address && (
                <div id="tracking-delivery-address-card" className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <MapPin className="w-4 h-4 text-orange-600 shrink-0" />
                    <span>Delivery Address</span>
                  </div>
                  <p className="text-xs text-slate-600 pl-5 leading-relaxed">
                    {order.customerSnapshot.address}
                  </p>
                  {order.notes && order.notes.includes('Delivery Instruction') && (
                    <p className="text-[11px] text-slate-500 pl-5 italic mt-1">
                      {order.notes}
                    </p>
                  )}
                </div>
              )}

              {/* Items Breakdown */}
              <div id="tracking-items-section" className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-orange-600" />
                    <span>Order Items ({order.items?.reduce((s, i) => s + i.quantity, 0) || 0})</span>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 bg-slate-50/50 rounded-2xl border border-slate-200/80 p-1">
                  {order.items?.map((item, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 block truncate">
                          {item.nameSnapshot}
                        </span>
                        <div className="text-[10px] text-slate-500 flex items-center gap-2">
                          <span>Qty: {item.quantity}</span>
                          <span>•</span>
                          <span>{formatMoney(item.unitPriceMinor)} each</span>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-slate-900 shrink-0">
                        {formatMoney(item.lineTotalMinor)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals Summary */}
              <div id="tracking-totals-card" className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatMoney(order.subtotalMinor)}</span>
                </div>
                {((order.cgstMinor || 0) + (order.sgstMinor || 0)) > 0 && (
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Taxes (GST)</span>
                    <span className="font-mono">
                      {formatMoney((order.cgstMinor || 0) + (order.sgstMinor || 0))}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs font-extrabold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Grand Total</span>
                  <span id="tracking-grand-total" className="font-mono text-sm text-orange-600">
                    {formatMoney(order.grandTotalMinor)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        {order && (
          <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center gap-3 shrink-0">
            <button
              type="button"
              id="tracking-view-invoice-btn"
              onClick={handleOpenInvoice}
              className="flex-1 py-3 px-3 glass-neu-btn text-slate-800 text-xs font-bold rounded-2xl border border-slate-200/80 flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <Receipt className="w-4 h-4 text-slate-600" />
              <span>View Invoice</span>
            </button>

            <button
              type="button"
              id="tracking-back-to-menu-btn"
              onClick={() => {
                onClose();
                if (onBackToMenu) onBackToMenu();
              }}
              className="flex-1 py-3 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-2xl shadow-sm flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <span>Back to Menu</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
