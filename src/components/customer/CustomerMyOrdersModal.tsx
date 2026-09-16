import React, { useState, useEffect } from 'react';
import {
  X,
  ArrowLeft,
  ShoppingBag,
  Clock,
  ChevronRight,
  Loader2,
  AlertCircle,
  Sparkles,
  Receipt,
  Compass
} from 'lucide-react';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { Order, OrderStatus } from '../../types/order';
import {
  getCustomerOrders,
  getTrackedOrders,
  TrackedOrderReference,
  getCustomerStatusDetails
} from '../../services/customerOrderTrackingService';
import { formatMoney } from '../../utils/money';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

export interface CustomerMyOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOrderToTrack: (restaurantId: string, orderId: string) => void;
}

export const CustomerMyOrdersModal: React.FC<CustomerMyOrdersModalProps> = ({
  isOpen,
  onClose,
  onSelectOrderToTrack
}) => {
  const { customer, firebaseUser } = useCustomerAuth();
  const currentUid = customer?.customerId || firebaseUser?.uid || null;

  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [orders, setOrders] = useState<TrackedOrderReference[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const tracked = getTrackedOrders(currentUid);
      setOrders(tracked);

      // If authenticated, also attempt to fetch updated Firestore status
      if (currentUid) {
        const fullOrders = await getCustomerOrders(currentUid);
        if (fullOrders && fullOrders.length > 0) {
          const mapped: TrackedOrderReference[] = fullOrders.map((o) => ({
            orderId: o.id,
            restaurantId: o.restaurantId,
            orderNumber: o.orderNumber || o.id,
            restaurantName: o.restaurantId,
            orderType: o.orderType,
            status: o.status,
            grandTotalMinor: o.grandTotalMinor,
            itemCount: o.items?.reduce((s, i) => s + i.quantity, 0) || 0,
            placedAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
            customerId: o.customerId
          }));
          setOrders(mapped);
        }
      }
    } catch (err) {
      console.warn('[CustomerMyOrders] Error loading orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadOrders();
    }
  }, [isOpen, currentUid]);

  useModalBackHandler(isOpen, onClose, 'customer-my-orders-modal');

  if (!isOpen) return null;

  const activeOrders = orders.filter(
    (o) => o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled'
  );
  const pastOrders = orders.filter(
    (o) => o.status === 'completed' || o.status === 'served' || o.status === 'cancelled'
  );

  const displayedOrders = activeTab === 'active' ? activeOrders : pastOrders;

  const formatPlacedTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    } catch {
      return '';
    }
    return '';
  };

  const getStatusBadge = (status: OrderStatus, orderType: string) => {
    const details = getCustomerStatusDetails(status, orderType);
    if (status === 'cancelled') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 uppercase">
          Cancelled
        </span>
      );
    }
    if (status === 'completed' || status === 'served') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase">
          {orderType === 'delivery' ? 'Delivered' : 'Completed'}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 uppercase flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-600 animate-pulse" />
        {details.label}
      </span>
    );
  };

  return (
    <div
      id="customer-my-orders-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="customer-my-orders-modal-card"
        className="bg-white rounded-3xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200/80 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              id="my-orders-back-btn"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-200/60 transition-colors shrink-0"
              title="Close"
            >
              <ArrowLeft className="w-5 h-5 text-slate-700" />
            </button>
            <div>
              <h2 id="my-orders-title" className="text-base font-extrabold text-slate-900 tracking-tight">
                My Orders
              </h2>
              <p className="text-[11px] text-slate-500">
                {customer ? `Signed in as ${customer.name}` : 'Guest session orders'}
              </p>
            </div>
          </div>

          <button
            id="close-my-orders-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="p-3 bg-slate-100/70 border-b border-slate-200 flex gap-2 shrink-0">
          <button
            type="button"
            id="my-orders-active-tab-btn"
            onClick={() => setActiveTab('active')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'active'
                ? 'bg-white text-orange-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Active Orders</span>
            {activeOrders.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-orange-600 text-white text-[10px] font-bold flex items-center justify-center">
                {activeOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            id="my-orders-history-tab-btn"
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Past Orders</span>
            {pastOrders.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold">
                {pastOrders.length}
              </span>
            )}
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 space-y-2">
              <Loader2 className="w-6 h-6 text-orange-600 animate-spin" />
              <span className="text-xs text-slate-500 font-medium">Loading orders...</span>
            </div>
          )}

          {!isLoading && displayedOrders.length === 0 && (
            <div id="my-orders-empty-state" className="text-center py-12 px-4 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-extrabold text-slate-800">
                  {activeTab === 'active' ? 'No Active Orders' : 'No Past Orders'}
                </h4>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                  {activeTab === 'active'
                    ? 'When you place an online order, its live progress will appear here.'
                    : 'Your completed and past online orders will be archived here.'}
                </p>
              </div>
            </div>
          )}

          {!isLoading && displayedOrders.map((order) => (
            <div
              key={`${order.restaurantId}-${order.orderId}`}
              id={`order-card-${order.orderId}`}
              className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs hover:border-orange-300 transition-all space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono font-extrabold text-xs text-slate-900 block truncate">
                    #{order.orderNumber}
                  </span>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {formatPlacedTime(order.placedAt)}
                  </span>
                </div>
                <div>{getStatusBadge(order.status, order.orderType)}</div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <div className="text-[11px] text-slate-600 font-medium capitalize">
                  {order.orderType} • {order.itemCount} item{order.itemCount !== 1 ? 's' : ''}
                </div>
                <span className="font-mono font-extrabold text-slate-900">
                  {formatMoney(order.grandTotalMinor)}
                </span>
              </div>

              <button
                type="button"
                id={`track-order-card-btn-${order.orderId}`}
                onClick={() => {
                  onClose();
                  onSelectOrderToTrack(order.restaurantId, order.orderId);
                }}
                className="w-full py-2 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
              >
                <Compass className="w-3.5 h-3.5 text-orange-600" />
                <span>Track Order</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
