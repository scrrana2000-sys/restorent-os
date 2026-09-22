import React, { useState, useEffect, useMemo } from 'react';
import {
  ShoppingBag,
  Truck,
  Clock,
  CheckCircle2,
  CookingPot,
  Ban,
  Search,
  Phone,
  MapPin,
  FileText,
  AlertCircle,
  RefreshCw,
  Printer,
  ChevronRight,
  Utensils,
  CreditCard,
  Banknote,
  Sparkles,
  Volume2,
  VolumeX,
  Eye,
  Check
} from 'lucide-react';
import { Order, OrderStatus } from '../../types/order';
import { orderService } from '../../services/orderService';
import { kotService } from '../../services/kotService';
import { printerService } from '../../services/printer/PrinterService';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/money';
import { OnlineOrderAcceptModal } from './OnlineOrderAcceptModal';
import { OnlineOrderRejectModal } from './OnlineOrderRejectModal';
import { isSoundAlertEnabled, setSoundAlertEnabled } from '../../utils/soundAlert';

interface OnlineOrdersQueueProps {
  focusedOrderId?: string | null;
  onClearFocusedOrder?: () => void;
  onViewBillModal?: (order: Order) => void;
  onCollectPayment?: (order: Order) => void;
}

type QueueTab = 'pending' | 'preparing' | 'ready' | 'history';

export const OnlineOrdersQueue: React.FC<OnlineOrdersQueueProps> = ({
  focusedOrderId,
  onClearFocusedOrder,
  onViewBillModal,
  onCollectPayment
}) => {
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  const restaurantId = restaurant?.restaurantId || '';
  const symbol = restaurant?.currencySymbol || '₹';

  // Orders state
  const [onlineOrders, setOnlineOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<QueueTab>('pending');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(isSoundAlertEnabled());

  // Action modals state
  const [acceptModalOrder, setAcceptModalOrder] = useState<Order | null>(null);
  const [rejectModalOrder, setRejectModalOrder] = useState<Order | null>(null);
  const [isActionSubmitting, setIsActionSubmitting] = useState<boolean>(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);

  // Subscribe to real-time online orders
  useEffect(() => {
    if (!restaurantId) return;

    setLoading(true);
    setError(null);

    const unsubscribe = orderService.subscribeToOnlineOrders(
      restaurantId,
      (orders) => {
        setOnlineOrders(orders);
        setLoading(false);
      },
      (err) => {
        console.warn('[OnlineOrdersQueue] Subscription notice:', err);
        setError(err?.message || 'Failed to sync online orders');
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [restaurantId]);

  // If a focusedOrderId is provided, switch to the appropriate tab and highlight it
  useEffect(() => {
    if (!focusedOrderId || onlineOrders.length === 0) return;
    const target = onlineOrders.find((o) => o.id === focusedOrderId);
    if (target) {
      if (target.status === 'confirmed' || target.status === 'draft') {
        setActiveTab('pending');
      } else if (target.status === 'sentToKitchen' || target.status === 'preparing') {
        setActiveTab('preparing');
      } else if (target.status === 'ready') {
        setActiveTab('ready');
      } else {
        setActiveTab('history');
      }
    }
  }, [focusedOrderId, onlineOrders]);

  // Sound toggle
  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setSoundAlertEnabled(next);
  };

  // Filtered orders by tab and search query
  const pendingOrders = useMemo(
    () => onlineOrders.filter((o) => o.status === 'confirmed' || o.status === 'draft'),
    [onlineOrders]
  );

  const preparingOrders = useMemo(
    () => onlineOrders.filter((o) => o.status === 'sentToKitchen' || o.status === 'preparing'),
    [onlineOrders]
  );

  const readyOrders = useMemo(
    () => onlineOrders.filter((o) => o.status === 'ready'),
    [onlineOrders]
  );

  const historyOrders = useMemo(
    () => onlineOrders.filter((o) => o.status === 'completed' || o.status === 'cancelled' || o.status === 'served'),
    [onlineOrders]
  );

  const currentTabOrders = useMemo(() => {
    let list: Order[] = [];
    switch (activeTab) {
      case 'pending':
        list = pendingOrders;
        break;
      case 'preparing':
        list = preparingOrders;
        break;
      case 'ready':
        list = readyOrders;
        break;
      case 'history':
        list = historyOrders;
        break;
    }

    if (!searchQuery.trim()) return list;

    const query = searchQuery.toLowerCase().trim();
    return list.filter(
      (o) =>
        o.orderNumber?.toLowerCase().includes(query) ||
        o.customerSnapshot?.name?.toLowerCase().includes(query) ||
        o.customerSnapshot?.phone?.toLowerCase().includes(query) ||
        o.customerSnapshot?.address?.toLowerCase().includes(query)
    );
  }, [activeTab, pendingOrders, preparingOrders, readyOrders, historyOrders, searchQuery]);

  // Action Handlers
  const handleAcceptOrder = async (orderId: string, prepTimeMinutes: number) => {
    if (!restaurantId) return;
    setIsActionSubmitting(true);
    setError(null);
    try {
      const updated = await orderService.acceptOnlineOrder(
        restaurantId,
        orderId,
        user?.uid || 'staff',
        prepTimeMinutes
      );
      setActionSuccess(`Order #${updated.orderNumber || orderId} accepted! Sent to kitchen with ${prepTimeMinutes}m prep timer.`);
      setTimeout(() => setActionSuccess(null), 4000);
      setAcceptModalOrder(null);
      if (onClearFocusedOrder) onClearFocusedOrder();
    } catch (err: any) {
      setError(err?.message || 'Failed to accept online order.');
      throw err;
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleRejectOrder = async (orderId: string, rejectionReason: string) => {
    if (!restaurantId) return;
    setIsActionSubmitting(true);
    setError(null);
    try {
      const updated = await orderService.rejectOnlineOrder(
        restaurantId,
        orderId,
        user?.uid || 'staff',
        rejectionReason
      );
      setActionSuccess(`Order #${updated.orderNumber || orderId} rejected.`);
      setTimeout(() => setActionSuccess(null), 4000);
      setRejectModalOrder(null);
      if (onClearFocusedOrder) onClearFocusedOrder();
    } catch (err: any) {
      setError(err?.message || 'Failed to reject online order.');
      throw err;
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleMarkReady = async (order: Order) => {
    if (!restaurantId) return;
    setIsActionSubmitting(true);
    setError(null);
    try {
      await orderService.markOnlineOrderReady(
        restaurantId,
        order.id,
        user?.uid || 'staff'
      );
      setActionSuccess(`Order #${order.orderNumber} marked Ready for ${order.orderType === 'delivery' ? 'Dispatch' : 'Pickup'}!`);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setError(err?.message || 'Failed to mark order ready.');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleCompleteOrder = async (order: Order) => {
    if (!restaurantId) return;
    setIsActionSubmitting(true);
    setError(null);

    try {
      const dueAmount = order.dueAmountMinor ?? Math.max(
        0,
        (order.grandTotalMinor || 0) - (order.paidAmountMinor || 0)
      );

      // Handover/delivery must never bypass financial settlement.
      if (dueAmount > 0) {
        setError(
          `Outstanding due of ₹${(dueAmount / 100).toFixed(2)} must be collected before ${order.orderType === 'delivery' ? 'delivery' : 'pickup'}.`
        );
        return;
      }

      // Online handover is handled atomically at the trusted server boundary.
      // Do not perform a client-side KOT permission check first: that can use a
      // stale browser role cache and reject a valid owner/manager/cashier/captain.
      await orderService.completeOnlineOrder(
        restaurantId,
        order.id,
        user?.uid || 'staff'
      );

      setActionSuccess(
        `Order #${order.orderNumber} ${order.orderType === 'delivery' ? 'marked Delivered' : 'marked Picked Up'} successfully.`
      );
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setError(err?.message || 'Failed to complete order handover.');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handlePrintReceipt = async (order: Order) => {
    if (!restaurantId) return;
    setPrintingOrderId(order.id);
    try {
      await printerService.printBill(restaurantId, order, restaurant);
    } catch (err) {
      console.warn('Printing error:', err);
    } finally {
      setPrintingOrderId(null);
    }
  };

  return (
    <div id="online-orders-queue-container" className="space-y-5">
      {/* Alert Notices */}
      {actionSuccess && (
        <div
          data-testid="online-action-success-banner"
          className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
            <Check className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div
          data-testid="online-action-error-banner"
          className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-rose-700 hover:text-rose-900">
            &times;
          </button>
        </div>
      )}

      {/* Header & Tabs Toolbar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600 overflow-x-auto max-w-full">
          <button
            type="button"
            data-testid="tab-online-pending"
            onClick={() => setActiveTab('pending')}
            className={`px-3.5 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'pending'
                ? 'bg-white text-indigo-600 shadow-xs'
                : 'hover:text-slate-900'
            }`}
          >
            <span>New / Pending Action</span>
            {pendingOrders.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-black animate-pulse">
                {pendingOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="tab-online-preparing"
            onClick={() => setActiveTab('preparing')}
            className={`px-3.5 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'preparing'
                ? 'bg-white text-amber-600 shadow-xs'
                : 'hover:text-slate-900'
            }`}
          >
            <span>In Kitchen</span>
            {preparingOrders.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black">
                {preparingOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="tab-online-ready"
            onClick={() => setActiveTab('ready')}
            className={`px-3.5 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'ready'
                ? 'bg-white text-emerald-600 shadow-xs'
                : 'hover:text-slate-900'
            }`}
          >
            <span>Ready for Handover</span>
            {readyOrders.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black">
                {readyOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="tab-online-history"
            onClick={() => setActiveTab('history')}
            className={`px-3.5 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'history'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'hover:text-slate-900'
            }`}
          >
            <span>Online History</span>
            <span className="text-slate-400 font-normal">({historyOrders.length})</span>
          </button>
        </div>

        {/* Controls: Sound Toggle & Search */}
        <div className="flex items-center gap-3 flex-1 sm:flex-initial justify-end">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="input-search-online-orders"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customer, phone, order #..."
              className="w-full pl-9 pr-3.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          <button
            type="button"
            data-testid="btn-toggle-sound-alert"
            onClick={handleToggleSound}
            title={soundEnabled ? 'Mute order alert sounds' : 'Enable order alert sounds'}
            className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              soundEnabled
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
            }`}
          >
            {soundEnabled ? (
              <>
                <Volume2 className="w-4 h-4 text-indigo-600" />
                <span className="hidden md:inline">Alert Sound On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4" />
                <span className="hidden md:inline">Sound Muted</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Order Cards Grid */}
      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-600 mb-2" />
          <span className="text-xs font-semibold">Loading live online orders...</span>
        </div>
      ) : currentTabOrders.length === 0 ? (
        <div className="p-12 flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">
            {activeTab === 'pending'
              ? 'No Pending Online Orders'
              : activeTab === 'preparing'
              ? 'No Orders in Kitchen'
              : activeTab === 'ready'
              ? 'No Orders Waiting for Handover'
              : 'No Past Online Orders Found'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm">
            {activeTab === 'pending'
              ? 'Incoming orders submitted from customer web discovery will appear here with instant sound alerts.'
              : 'Orders transition through the queue as kitchen prep and fulfillment progress.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {currentTabOrders.map((order) => {
            const isFocused = focusedOrderId === order.id;
            const isDelivery = order.orderType === 'delivery';
            const isTakeaway = order.orderType === 'takeaway';
            const isPending = order.status === 'confirmed' || order.status === 'draft';
            const isPreparing = order.status === 'sentToKitchen' || order.status === 'preparing';
            const isReady = order.status === 'ready';
            const isCompleted = order.status === 'completed' || order.status === 'served';
            const isCancelled = order.status === 'cancelled';

            const dueAmount = order.dueAmountMinor ?? Math.max(0, (order.grandTotalMinor || 0) - (order.paidAmountMinor || 0));
            const isPrepaid = dueAmount === 0 || order.paymentStatus === 'paid';

            return (
              <div
                key={order.id}
                id={`online-order-card-${order.id}`}
                data-testid={`online-order-card-${order.id}`}
                className={`bg-white rounded-2xl border transition-all duration-200 flex flex-col overflow-hidden shadow-xs hover:shadow-md ${
                  isFocused
                    ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-indigo-100'
                    : isPending
                    ? 'border-indigo-200 ring-1 ring-indigo-500/20'
                    : 'border-slate-200'
                }`}
              >
                {/* Header */}
                <div className="p-4 bg-slate-50/80 border-b border-slate-100 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-black font-mono text-slate-900">
                        #{order.orderNumber}
                      </span>
                      {/* Order Type Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${
                          isDelivery
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {isDelivery ? (
                          <>
                            <Truck className="w-3.5 h-3.5 text-purple-600" />
                            <span>Delivery</span>
                          </>
                        ) : (
                          <>
                            <ShoppingBag className="w-3.5 h-3.5 text-amber-600" />
                            <span>Takeaway</span>
                          </>
                        )}
                      </span>

                      {/* Status Badge */}
                      {isPending && (
                        <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-extrabold tracking-wider uppercase animate-pulse">
                          Pending Action
                        </span>
                      )}
                      {isPreparing && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-extrabold tracking-wider uppercase">
                          Preparing ({order.estimatedPrepMinutes || 20}m)
                        </span>
                      )}
                      {isReady && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-extrabold tracking-wider uppercase flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Ready
                        </span>
                      )}
                      {isCancelled && (
                        <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-extrabold tracking-wider uppercase">
                          Cancelled
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
                      <span>
                        {order.createdAt
                          ? new Date(
                              (order.createdAt as any)?.toDate?.() || order.createdAt
                            ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : 'Just now'}
                      </span>
                      <span>&bull;</span>
                      <span>{order.items?.length || 0} items</span>
                    </div>
                  </div>

                  {/* Payment Pill */}
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-black text-slate-900">
                      {formatMoney(order.grandTotalMinor, symbol)}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md mt-1 flex items-center gap-1 ${
                        isPrepaid
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {isPrepaid ? (
                        <>
                          <CreditCard className="w-3 h-3" />
                          <span>Prepaid Online</span>
                        </>
                      ) : (
                        <>
                          <Banknote className="w-3 h-3 text-amber-600" />
                          <span>Collect ₹{(dueAmount / 100).toFixed(2)} COD</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Customer Details & Address */}
                <div className="p-3.5 bg-white border-b border-slate-100 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-black">
                        {(order.customerSnapshot?.name || 'C').charAt(0).toUpperCase()}
                      </span>
                      {order.customerSnapshot?.name || 'Guest Customer'}
                    </span>
                    {order.customerSnapshot?.phone && (
                      <a
                        href={`tel:${order.customerSnapshot.phone}`}
                        className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 hover:underline"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{order.customerSnapshot.phone}</span>
                      </a>
                    )}
                  </div>

                  {isDelivery && order.customerSnapshot?.address && (
                    <div className="flex items-start gap-1.5 text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span className="text-[11px] leading-relaxed">
                        {order.customerSnapshot.address}
                      </span>
                    </div>
                  )}

                  {order.notes && (
                    <div className="flex items-start gap-1.5 text-amber-900 bg-amber-50/70 p-2 rounded-xl border border-amber-100">
                      <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span className="text-[11px] font-medium leading-relaxed">
                        Note: {order.notes}
                      </span>
                    </div>
                  )}

                  {order.cancellationReason && (
                    <div className="flex items-start gap-1.5 text-rose-800 bg-rose-50 p-2 rounded-xl border border-rose-200 text-[11px]">
                      <Ban className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                      <span>Rejection reason: {order.cancellationReason}</span>
                    </div>
                  )}
                </div>

                {/* Ordered Items Breakdown */}
                <div className="p-3.5 flex-1 space-y-1.5 bg-slate-50/30">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1">
                    Order Items
                  </span>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {order.items?.map((item, idx) => (
                      <div
                        key={`${item.itemId}-${idx}`}
                        className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                            {item.quantity}x
                          </span>
                          <span className="font-semibold text-slate-800">
                            {item.nameSnapshot}
                          </span>
                        </div>
                        <span className="font-mono text-slate-600">
                          {formatMoney(item.lineTotalMinor, symbol)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Operational Action Footer */}
                <div className="p-3 bg-white border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`btn-print-receipt-${order.id}`}
                      onClick={() => handlePrintReceipt(order)}
                      disabled={printingOrderId === order.id}
                      className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1 transition-colors"
                      title="Print Order Receipt"
                    >
                      <Printer className={`w-3.5 h-3.5 ${printingOrderId === order.id ? 'animate-pulse text-indigo-600' : ''}`} />
                    </button>
                    {onViewBillModal && (
                      <button
                        type="button"
                        data-testid={`btn-view-bill-${order.id}`}
                        onClick={() => onViewBillModal(order)}
                        className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1 transition-colors"
                        title="View Full Bill & Details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Contextual Primary Actions */}
                  <div className="flex items-center gap-2">
                    {!isPrepaid && onCollectPayment && (
                      <button
                        type="button"
                        data-testid={`btn-collect-due-${order.id}`}
                        onClick={() => onCollectPayment(order)}
                        disabled={isActionSubmitting}
                        className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
                        title="Collect outstanding payment before handover"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        <span>Collect Due</span>
                      </button>
                    )}
                    {isPending && (
                      <>
                        <button
                          type="button"
                          data-testid={`btn-reject-online-${order.id}`}
                          onClick={() => setRejectModalOrder(order)}
                          disabled={isActionSubmitting}
                          className="px-3 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-bold transition-colors disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          data-testid={`btn-accept-online-${order.id}`}
                          onClick={() => setAcceptModalOrder(order)}
                          disabled={isActionSubmitting}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Accept Order</span>
                        </button>
                      </>
                    )}

                    {isPreparing && (
                      <button
                        type="button"
                        data-testid={`btn-mark-ready-${order.id}`}
                        onClick={() => handleMarkReady(order)}
                        disabled={isActionSubmitting}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Mark Ready for {isDelivery ? 'Dispatch' : 'Pickup'}</span>
                      </button>
                    )}

                    {isReady && (
                      <button
                        type="button"
                        data-testid={`btn-complete-online-${order.id}`}
                        onClick={() => handleCompleteOrder(order)}
                        disabled={isActionSubmitting}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isDelivery ? 'Mark Delivered' : 'Mark Picked Up'}</span>
                      </button>
                    )}

                    {isCompleted && (
                      <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Accept Modal */}
      <OnlineOrderAcceptModal
        order={acceptModalOrder}
        isOpen={Boolean(acceptModalOrder)}
        onClose={() => setAcceptModalOrder(null)}
        onAccept={handleAcceptOrder}
        isSubmitting={isActionSubmitting}
      />

      {/* Reject Modal */}
      <OnlineOrderRejectModal
        order={rejectModalOrder}
        isOpen={Boolean(rejectModalOrder)}
        onClose={() => setRejectModalOrder(null)}
        onReject={handleRejectOrder}
        isSubmitting={isActionSubmitting}
      />
    </div>
  );
};
