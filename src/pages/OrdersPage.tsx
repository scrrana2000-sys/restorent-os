import React, { useState, useEffect, useMemo } from 'react';
import { Order, OrderType, OrderStatus } from '../types/order';
import { Table } from '../types/table';
import { orderService, OrderHistoryFilterOptions } from '../services/orderService';
import { tableService } from '../services/tableService';
import { paymentService } from '../services/paymentService';
import { useRestaurant } from '../context/RestaurantContext';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../utils/money';
import { getFormattedTableLabel } from '../utils/tableLabel';
import { hasPermission } from '../utils/permissions';
import { BillReceiptModal } from '../components/pos/BillReceiptModal';
import { ReceivePaymentModal } from '../components/pos/ReceivePaymentModal';
import { WhatsAppBillModal } from '../components/pos/WhatsAppBillModal';
import { OnlineOrdersQueue } from '../components/orders/OnlineOrdersQueue';
import {
  History,
  Search,
  Filter,
  Calendar,
  Receipt,
  RotateCw,
  Eye,
  CheckCircle2,
  AlertCircle,
  Clock,
  Utensils,
  CreditCard,
  RefreshCw,
  ArrowUpDown,
  ShoppingBag,
  Truck,
  Building2,
  X,
  FileText,
  DollarSign,
  ChevronDown,
  Trash2,
  Ban,
  MessageSquare,
  Globe
} from 'lucide-react';

export interface OrdersPageProps {
  initialTab?: 'online_queue' | 'history';
  focusedOrderId?: string | null;
}

export const OrdersPage: React.FC<OrdersPageProps> = ({
  initialTab = 'history',
  focusedOrderId
}) => {
  const { restaurant } = useRestaurant();
  const { user, profile } = useAuth();
  const symbol = restaurant?.currencySymbol || '₹';
  const role = profile?.role || 'owner';
  const restaurantId = restaurant?.restaurantId || (restaurant as any)?.id;

  // Top level view mode: Online Queue vs Full Order History
  const [activeViewMode, setActiveViewMode] = useState<'online_queue' | 'history'>(
    focusedOrderId ? 'online_queue' : initialTab
  );

  // Filters State
  const [dateRangePreset, setDateRangePreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOrderType, setSelectedOrderType] = useState<OrderType | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | 'all'>('all');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
  const [selectedTableId, setSelectedTableId] = useState<string>('all');

  // Data State
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Selected Order for Bill / Details
  const [selectedBillOrder, setSelectedBillOrder] = useState<Order | null>(null);
  const [isReprintMode, setIsReprintMode] = useState<boolean>(false);
  const [whatsAppOrder, setWhatsAppOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [receivePaymentOrder, setReceivePaymentOrder] = useState<Order | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Reopen confirmation dialog
  const [reopenOrderId, setReopenOrderId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>('');
  const [isActionSubmitting, setIsActionSubmitting] = useState<boolean>(false);

  // Cancel and Delete dialogs
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);

  // Compute actual date filters based on preset
  const dateBounds = useMemo(() => {
    const now = new Date();
    if (dateRangePreset === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end };
    }
    if (dateRangePreset === 'yesterday') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      return { start, end };
    }
    if (dateRangePreset === 'week') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start, end: null };
    }
    if (dateRangePreset === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: null };
    }
    if (dateRangePreset === 'custom') {
      const start = customStartDate ? new Date(customStartDate) : null;
      const end = customEndDate ? new Date(customEndDate + 'T23:59:59') : null;
      return { start, end };
    }
    return { start: null, end: null };
  }, [dateRangePreset, customStartDate, customEndDate]);

  // Table lookup map
  const tableMap = useMemo(() => {
    const map = new Map<string, Table>();
    tables.forEach((t) => map.set(t.id, t));
    return map;
  }, [tables]);

  // Load Tables for dropdown filter
  useEffect(() => {
    if (!restaurantId) return;
    tableService.getTables(restaurantId).then(setTables).catch((err) => {
      console.warn('[OrdersPage] Failed to load tables:', err);
    });
  }, [restaurantId]);

  // Fetch Order History
  const fetchOrderHistory = async (isManualRefresh: boolean = false) => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const filterOptions: OrderHistoryFilterOptions = {
        startDate: dateBounds.start,
        endDate: dateBounds.end,
        orderType: selectedOrderType,
        orderStatus: selectedStatus,
        paymentStatus: selectedPaymentStatus,
        tableId: selectedTableId !== 'all' ? selectedTableId : undefined,
        searchQuery: searchQuery.trim() || undefined,
        limitCount: 100
      };

      const result = await orderService.queryOrderHistory(restaurantId, filterOptions);
      setOrders(result.orders);
    } catch (err: any) {
      console.error('[OrdersPage] Failed to retrieve order history:', err);
      let errMsg = err?.message || 'Failed to retrieve historical order records.';
      if (typeof errMsg === 'string' && errMsg.startsWith('{') && errMsg.includes('"error"')) {
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed.error) errMsg = parsed.error;
        } catch {}
      }
      setError(errMsg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrderHistory();
  }, [
    restaurantId,
    dateBounds.start?.getTime(),
    dateBounds.end?.getTime(),
    selectedOrderType,
    selectedStatus,
    selectedPaymentStatus,
    selectedTableId,
    searchQuery
  ]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const count = orders.length;
    let totalBilled = 0;
    let totalPaid = 0;
    let totalDue = 0;

    orders.forEach((o) => {
      if (o.status !== 'cancelled') {
        totalBilled += o.grandTotalMinor || 0;
        totalPaid += o.paidAmountMinor || 0;
        totalDue += o.dueAmountMinor || 0;
      }
    });

    return { count, totalBilled, totalPaid, totalDue };
  }, [orders]);

  // Handle Safe Reopen
  const handleReopenOrder = async (orderId: string) => {
    if (!restaurantId || !user?.uid) return;
    setIsActionSubmitting(true);
    setError(null);
    try {
      await orderService.reopenOrder(
        restaurantId,
        orderId,
        user.uid,
        reopenReason || 'Reopened for staff correction'
      );
      setReopenOrderId(null);
      setReopenReason('');
      setActionSuccess(`Order #${orderId} successfully reopened for adjustments.`);
      setTimeout(() => setActionSuccess(null), 4000);
      await fetchOrderHistory(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to reopen order.');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleCompleteOrder = async (orderId: string, orderNumber?: string) => {
    if (!restaurantId) return;
    setIsActionSubmitting(true);
    setError(null);
    try {
      if (orderService.completeOrder) {
        await orderService.completeOrder(restaurantId, orderId, user?.uid || 'staff');
      } else {
        await orderService.updateOrderStatus(restaurantId, orderId, 'completed', user?.uid || 'staff');
      }
      setActionSuccess(`Order #${orderNumber || orderId.substring(0, 8)} marked as completed.`);
      setTimeout(() => setActionSuccess(null), 4000);
      await fetchOrderHistory(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to complete order.');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!restaurantId || !user?.uid) return;
    setIsActionSubmitting(true);
    setError(null);
    try {
      await orderService.updateOrderStatus(
        restaurantId,
        orderId,
        'cancelled',
        user.uid,
        cancelReason || 'Cancelled by staff'
      );
      setCancelOrderId(null);
      setCancelReason('');
      setActionSuccess(`Order #${orderId} successfully cancelled.`);
      setTimeout(() => setActionSuccess(null), 4000);
      await fetchOrderHistory(true);
    } catch (err: any) {
      let errMsg = err?.message || 'Failed to cancel order.';
      if (typeof errMsg === 'string' && errMsg.startsWith('{') && errMsg.includes('"error"')) {
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed.error) errMsg = parsed.error;
        } catch {}
      }
      setError(errMsg);
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!restaurantId || !user?.uid) return;
    setIsActionSubmitting(true);
    setError(null);
    try {
      await orderService.deleteOrder(
        restaurantId,
        orderId,
        user.uid
      );
      setDeleteOrderId(null);
      setActionSuccess(`Order successfully deleted from history.`);
      setTimeout(() => setActionSuccess(null), 4000);
      await fetchOrderHistory(true);
    } catch (err: any) {
      let errMsg = err?.message || 'Failed to delete order.';
      if (typeof errMsg === 'string' && errMsg.startsWith('{') && errMsg.includes('"error"')) {
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed.error) errMsg = parsed.error;
        } catch {}
      }
      setError(errMsg);
    } finally {
      setIsActionSubmitting(false);
    }
  };

  return (
    <div data-testid="orders-history-page" className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 border border-indigo-500/20 flex items-center justify-center">
              {activeViewMode === 'online_queue' ? (
                <Globe className="w-5 h-5 text-indigo-600" />
              ) : (
                <History className="w-5 h-5 text-indigo-600" />
              )}
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                {activeViewMode === 'online_queue'
                  ? 'Customer Online Orders'
                  : 'Order History & Previous Bills'}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeViewMode === 'online_queue'
                  ? 'Live operations queue: accept/reject incoming orders, send to kitchen, track prep, and fulfill.'
                  : 'Authoritative transaction archive, GST invoices, and historical bill retrieval.'}
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher & Refresh Button */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center p-1 bg-slate-100 rounded-xl text-xs font-bold">
            <button
              type="button"
              data-testid="switch-view-online-queue"
              onClick={() => setActiveViewMode('online_queue')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                activeViewMode === 'online_queue'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Online Orders</span>
            </button>
            <button
              type="button"
              data-testid="switch-view-order-history"
              onClick={() => setActiveViewMode('history')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                activeViewMode === 'history'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>All History</span>
            </button>
          </div>

          {activeViewMode === 'history' && (
            <button
              type="button"
              data-testid="btn-refresh-orders"
              onClick={() => fetchOrderHistory(true)}
              disabled={loading || refreshing}
              className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center gap-2 shadow-xs transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-indigo-600' : ''}`} />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Render Online Orders Queue if in Online Queue View Mode */}
      {activeViewMode === 'online_queue' ? (
        <OnlineOrdersQueue
          focusedOrderId={focusedOrderId}
          onViewBillModal={(order) => setSelectedBillOrder(order)}
        />
      ) : (
        <>
          {/* Action Success Banner */}
      {actionSuccess && (
        <div
          data-testid="order-action-success-banner"
          className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div
          data-testid="order-error-banner"
          className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-700 hover:text-rose-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Filtered Orders</p>
          {loading ? (
            <div className="h-7 w-16 bg-slate-100 animate-pulse rounded-md mt-1" />
          ) : (
            <p data-testid="metric-order-count" className="text-2xl font-black text-slate-900 mt-1">
              {summaryMetrics.count}
            </p>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Billed</p>
          {loading ? (
            <div className="h-7 w-24 bg-slate-100 animate-pulse rounded-md mt-1" />
          ) : (
            <p data-testid="metric-total-billed" className="text-2xl font-black text-slate-900 mt-1">
              {formatMoney(summaryMetrics.totalBilled, symbol)}
            </p>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Collected</p>
          {loading ? (
            <div className="h-7 w-24 bg-slate-100 animate-pulse rounded-md mt-1" />
          ) : (
            <p data-testid="metric-total-collected" className="text-2xl font-black text-emerald-600 mt-1">
              {formatMoney(summaryMetrics.totalPaid, symbol)}
            </p>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Outstanding Due</p>
          {loading ? (
            <div className="h-7 w-24 bg-slate-100 animate-pulse rounded-md mt-1" />
          ) : (
            <p data-testid="metric-total-due" className="text-2xl font-black text-rose-600 mt-1">
              {formatMoney(summaryMetrics.totalDue, symbol)}
            </p>
          )}
        </div>
      </div>


      {/* Comprehensive Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="input-search-orders"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Order #, Customer, Phone..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          {/* Date Presets */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600 overflow-x-auto no-scrollbar max-w-full shrink-0">
            {(['today', 'yesterday', 'week', 'month', 'all', 'custom'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                data-testid={`filter-date-${preset}`}
                onClick={() => setDateRangePreset(preset)}
                className={`px-3 py-1.5 rounded-lg capitalize whitespace-nowrap transition-all active:scale-95 ${
                  dateRangePreset === preset
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
              >
                {preset === 'week' ? 'Last 7 Days' : preset === 'month' ? 'This Month' : preset}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Pickers (if custom selected) */}
        {dateRangePreset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-600">From:</span>
              <input
                type="date"
                data-testid="input-custom-start-date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-600">To:</span>
              <input
                type="date"
                data-testid="input-custom-end-date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        )}

        {/* Multi-Attribute Dropdown Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          {/* Order Type */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
              Order Type
            </label>
            <select
              data-testid="select-filter-order-type"
              value={selectedOrderType}
              onChange={(e) => setSelectedOrderType(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Types</option>
              <option value="dineIn">Dine-In</option>
              <option value="takeaway">Takeaway</option>
              <option value="delivery">Delivery</option>
            </select>
          </div>

          {/* Order Status */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
              Status
            </label>
            <select
              data-testid="select-filter-status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 capitalize"
            >
              <option value="all">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready</option>
              <option value="served">Served</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Payment Status */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
              Payment Status
            </label>
            <select
              data-testid="select-filter-payment-status"
              value={selectedPaymentStatus}
              onChange={(e) => setSelectedPaymentStatus(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Payments</option>
              <option value="paid">Fully Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid / Due</option>
            </select>
          </div>

          {/* Table */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
              Table
            </label>
            <select
              data-testid="select-filter-table"
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Tables</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  Table {t.tableNumber} {t.name ? `(${t.name})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Orders Table / List */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-500 text-xs">
            <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mx-auto mb-3" />
            <span>Loading historical orders from Firestore...</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs space-y-3">
            <History className="w-10 h-10 mx-auto text-slate-300" />
            <p className="font-bold text-slate-700 text-sm">No orders match the selected filters</p>
            <p className="text-slate-400">Try broadening your date range or clearing search criteria.</p>
            {dateRangePreset !== 'all' && (
              <button
                type="button"
                onClick={() => setDateRangePreset('all')}
                className="mt-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-xs font-bold transition-colors"
              >
                View All Orders (All Time)
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile View: High-density touch-optimized cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {orders.map((ord) => {
                const createdDate = ord.createdAt
                  ? new Date((ord.createdAt as any)?.toDate?.() || ord.createdAt)
                  : new Date();

                const dueAmount = Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
                const isFullyPaid = (ord.paidAmountMinor || 0) >= (ord.grandTotalMinor || 0) && (ord.grandTotalMinor || 0) > 0;
                const isPartiallyPaid = (ord.paidAmountMinor || 0) > 0 && (ord.paidAmountMinor || 0) < (ord.grandTotalMinor || 0);

                return (
                  <div
                    key={`mobile-${ord.id}`}
                    data-testid={`order-card-${ord.id}`}
                    className="p-4 space-y-3 bg-white hover:bg-slate-50/50 transition-colors"
                  >
                    {/* Card Header: Order #, Type & Table, Time */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-indigo-600 text-sm">
                            #{ord.orderNumber || ord.id.substring(0, 8)}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-500 font-medium">
                            {createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-700 font-semibold">
                          {ord.orderType === 'dineIn' && <Utensils className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                          {ord.orderType === 'takeaway' && <ShoppingBag className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                          {ord.orderType === 'delivery' && <Truck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                          <span>{ord.orderType === 'takeaway' ? 'Takeaway / Parcel' : ord.orderType}</span>
                          {ord.orderType === 'dineIn' && (
                            <span className="text-slate-500 font-medium">
                              ({getFormattedTableLabel(ord, tableMap)})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status & Payment Badges */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border capitalize ${
                            ord.status === 'completed'
                              ? 'bg-slate-100 border-slate-300 text-slate-700'
                              : ord.status === 'served'
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                              : ord.status === 'ready'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : ord.status === 'cancelled'
                              ? 'bg-rose-50 border-rose-200 text-rose-700'
                              : 'bg-amber-50 border-amber-200 text-amber-700'
                          }`}
                        >
                          {ord.status}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                            isFullyPaid
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : isPartiallyPaid
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : 'bg-rose-50 border-rose-200 text-rose-700'
                          }`}
                        >
                          {isFullyPaid ? 'Paid' : isPartiallyPaid ? 'Partial' : 'Unpaid'}
                        </span>
                      </div>
                    </div>

                    {/* Customer Info (if present) */}
                    {ord.customerSnapshot?.name && (
                      <div className="text-xs text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg flex items-center justify-between">
                        <span className="font-bold text-slate-800">{ord.customerSnapshot.name}</span>
                        {ord.customerSnapshot.phone && (
                          <span className="text-[11px] font-mono text-slate-500">{ord.customerSnapshot.phone}</span>
                        )}
                      </div>
                    )}

                    {/* Financial Summary */}
                    <div className="bg-slate-900 text-white rounded-xl p-2.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Total</span>
                        <span className="text-sm font-black font-mono text-white">
                          {formatMoney(ord.grandTotalMinor ?? 0, symbol)}
                        </span>
                      </div>

                      <div className="text-right font-mono">
                        <div className="text-emerald-400 font-bold text-xs">
                          Paid: {formatMoney(ord.paidAmountMinor || 0, symbol)}
                        </div>
                        {dueAmount > 0 && (
                          <div className="text-rose-400 font-bold text-xs">
                            Due: {formatMoney(dueAmount, symbol)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Mobile Action Buttons Bar */}
                    <div className="flex items-center gap-1.5 pt-1 overflow-x-auto no-scrollbar">
                      {/* Receive Payment / Pay Due Action */}
                      {dueAmount > 0 && ord.status !== 'cancelled' && hasPermission(role, 'process_payments') && (
                        <button
                          type="button"
                          data-testid={`btn-order-receive-payment-mobile-${ord.id}`}
                          onClick={() => setReceivePaymentOrder(ord)}
                          className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95 shrink-0"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>Pay Due</span>
                        </button>
                      )}

                      {/* Complete Order Action */}
                      {dueAmount === 0 && ord.status !== 'completed' && ord.status !== 'cancelled' && hasPermission(role, 'modify_orders') && (
                        <button
                          type="button"
                          data-testid={`btn-order-complete-mobile-${ord.id}`}
                          onClick={() => handleCompleteOrder(ord.id, ord.orderNumber)}
                          disabled={isActionSubmitting}
                          className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95 shrink-0"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Complete</span>
                        </button>
                      )}

                      {/* View Bill */}
                      <button
                        type="button"
                        data-testid={`btn-order-view-bill-mobile-${ord.id}`}
                        onClick={() => {
                          setSelectedBillOrder(ord);
                          setIsReprintMode(false);
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-bold transition-all flex items-center justify-center gap-1 border border-indigo-100 active:scale-95 shrink-0"
                        title="View Bill Receipt"
                      >
                        <Receipt className="w-4 h-4" />
                        <span>Bill</span>
                      </button>

                      {/* WhatsApp Bill */}
                      <button
                        type="button"
                        data-testid={`btn-order-whatsapp-mobile-${ord.id}`}
                        onClick={() => setWhatsAppOrder(ord)}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold transition-all flex items-center justify-center gap-1 border border-emerald-200 active:scale-95 shrink-0"
                        title="Send Bill via WhatsApp"
                      >
                        <MessageSquare className="w-4 h-4 text-[#25D366]" />
                        <span>WhatsApp</span>
                      </button>

                      {/* Order Details */}
                      <button
                        type="button"
                        data-testid={`btn-order-details-mobile-${ord.id}`}
                        onClick={() => setDetailOrder(ord)}
                        className="min-h-[38px] w-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors active:scale-95 shrink-0"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {/* Reopen Action (for managers/owners on completed/served orders) */}
                      {hasPermission(role, 'modify_orders') && ord.status === 'completed' && (
                        <button
                          type="button"
                          data-testid={`btn-order-reopen-mobile-${ord.id}`}
                          onClick={() => {
                            setReopenOrderId(ord.id);
                            setReopenReason('');
                          }}
                          className="min-h-[38px] px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold border border-amber-200 transition-colors active:scale-95 shrink-0"
                          title="Reopen Order"
                        >
                          Reopen
                        </button>
                      )}

                      {/* Cancel Action */}
                      {hasPermission(role, 'cancel_orders') && ord.status !== 'cancelled' && ord.status !== 'completed' && (
                        <button
                          type="button"
                          data-testid={`btn-order-cancel-mobile-${ord.id}`}
                          onClick={() => {
                            setCancelOrderId(ord.id);
                            setCancelReason('');
                          }}
                          className="min-h-[38px] w-9 flex items-center justify-center rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors active:scale-95 shrink-0"
                          title="Cancel Order"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop View: Full Responsive Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-extrabold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Order #</th>
                    <th className="py-3 px-4">Date / Time</th>
                    <th className="py-3 px-4">Type & Table</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Payment</th>
                    <th className="py-3 px-4 text-right">Grand Total</th>
                    <th className="py-3 px-4 text-right">Paid / Due</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {orders.map((ord) => {
                    const createdDate = ord.createdAt
                      ? new Date((ord.createdAt as any)?.toDate?.() || ord.createdAt)
                      : new Date();

                    const dueAmount = Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
                    const isFullyPaid = (ord.paidAmountMinor || 0) >= (ord.grandTotalMinor || 0) && (ord.grandTotalMinor || 0) > 0;
                    const isPartiallyPaid = (ord.paidAmountMinor || 0) > 0 && (ord.paidAmountMinor || 0) < (ord.grandTotalMinor || 0);

                    return (
                      <tr
                        key={ord.id}
                        data-testid={`order-row-${ord.id}`}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        {/* Order Number */}
                        <td className="py-3.5 px-4 font-mono font-bold text-indigo-600">
                          #{ord.orderNumber || ord.id.substring(0, 8)}
                        </td>

                        {/* Date / Time */}
                        <td className="py-3.5 px-4 text-slate-600">
                          <div>{createdDate.toLocaleDateString('en-IN')}</div>
                          <div className="text-[10px] text-slate-400">
                            {createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>

                        {/* Type & Table */}
                        <td className="py-3.5 px-4">
                          <div className="capitalize font-bold text-slate-800 flex items-center gap-1.5">
                            {ord.orderType === 'dineIn' && <Utensils className="w-3.5 h-3.5 text-amber-500" />}
                            {ord.orderType === 'takeaway' && <ShoppingBag className="w-3.5 h-3.5 text-indigo-500" />}
                            {ord.orderType === 'delivery' && <Truck className="w-3.5 h-3.5 text-emerald-500" />}
                            <span>{ord.orderType === 'takeaway' ? 'Takeaway / Parcel' : ord.orderType}</span>
                          </div>
                          {ord.orderType === 'dineIn' && (
                            <div className="text-[11px] text-slate-500 font-medium">
                              {getFormattedTableLabel(ord, tableMap)}
                            </div>
                          )}
                        </td>

                        {/* Customer */}
                        <td className="py-3.5 px-4 text-slate-600">
                          {ord.customerSnapshot?.name ? (
                            <div>
                              <div className="font-bold text-slate-800">{ord.customerSnapshot.name}</div>
                              {ord.customerSnapshot.phone && (
                                <div className="text-[10px] text-slate-400 font-mono">{ord.customerSnapshot.phone}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">Walk-in</span>
                          )}
                        </td>

                        {/* Order Status Badge */}
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border capitalize ${
                              ord.status === 'completed'
                                ? 'bg-slate-100 border-slate-300 text-slate-700'
                                : ord.status === 'served'
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                : ord.status === 'ready'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : ord.status === 'cancelled'
                                ? 'bg-rose-50 border-rose-200 text-rose-700'
                                : 'bg-amber-50 border-amber-200 text-amber-700'
                            }`}
                          >
                            {ord.status}
                          </span>
                        </td>

                        {/* Payment Status Badge */}
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                              isFullyPaid
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : isPartiallyPaid
                                ? 'bg-amber-50 border-amber-200 text-amber-700'
                                : 'bg-rose-50 border-rose-200 text-rose-700'
                            }`}
                          >
                            {isFullyPaid ? 'Paid' : isPartiallyPaid ? 'Partial' : 'Unpaid'}
                          </span>
                        </td>

                        {/* Grand Total */}
                        <td className="py-3.5 px-4 text-right font-black text-slate-900 font-mono">
                          {formatMoney(ord.grandTotalMinor ?? 0, symbol)}
                        </td>

                        {/* Paid / Due Breakdown */}
                        <td className="py-3.5 px-4 text-right text-[11px] font-mono">
                          <div className="text-emerald-700 font-bold">
                            Paid: {formatMoney(ord.paidAmountMinor || 0, symbol)}
                          </div>
                          {dueAmount > 0 && (
                            <div className="text-rose-600 font-bold">
                              Due: {formatMoney(dueAmount, symbol)}
                            </div>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Receive Payment / Pay Due Action */}
                            {dueAmount > 0 && ord.status !== 'cancelled' && hasPermission(role, 'process_payments') && (
                              <button
                                type="button"
                                data-testid={`btn-order-receive-payment-${ord.id}`}
                                onClick={() => setReceivePaymentOrder(ord)}
                                className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-xs transition-colors flex items-center gap-1"
                                title="Receive Payment against this order"
                              >
                                <CreditCard className="w-3 h-3" />
                                <span>Pay Due</span>
                              </button>
                            )}

                            {/* Complete Order Action (for settled non-completed orders) */}
                            {dueAmount === 0 && ord.status !== 'completed' && ord.status !== 'cancelled' && hasPermission(role, 'modify_orders') && (
                              <button
                                type="button"
                                data-testid={`btn-order-complete-${ord.id}`}
                                onClick={() => handleCompleteOrder(ord.id, ord.orderNumber)}
                                disabled={isActionSubmitting}
                                className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold shadow-xs transition-colors flex items-center gap-1"
                                title="Mark order as completed"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Complete</span>
                              </button>
                            )}

                            {/* View Bill */}
                            <button
                              type="button"
                              data-testid={`btn-order-view-bill-${ord.id}`}
                              onClick={() => {
                                setSelectedBillOrder(ord);
                                setIsReprintMode(false);
                              }}
                              className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors"
                              title="View GST Bill Receipt"
                            >
                              <Receipt className="w-4 h-4" />
                            </button>

                            {/* WhatsApp Bill */}
                            <button
                              type="button"
                              data-testid={`btn-order-whatsapp-${ord.id}`}
                              onClick={() => setWhatsAppOrder(ord)}
                              className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#25D366] transition-colors"
                              title="Send Bill to Customer on WhatsApp"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>

                            {/* Reprint Bill */}
                            <button
                              type="button"
                              data-testid={`btn-order-reprint-${ord.id}`}
                              onClick={() => {
                                setSelectedBillOrder(ord);
                                setIsReprintMode(true);
                              }}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                              title="Reprint Bill (Duplicate)"
                            >
                              <RotateCw className="w-4 h-4" />
                            </button>

                            {/* Order Details */}
                            <button
                              type="button"
                              data-testid={`btn-order-details-${ord.id}`}
                              onClick={() => setDetailOrder(ord)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                              title="View Items & Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {/* Reopen Action (for managers/owners on completed/served orders) */}
                            {hasPermission(role, 'modify_orders') && ord.status === 'completed' && (
                              <button
                                type="button"
                                data-testid={`btn-order-reopen-${ord.id}`}
                                onClick={() => {
                                  setReopenOrderId(ord.id);
                                  setReopenReason('');
                                }}
                                className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200 transition-colors"
                                title="Reopen Order for Adjustment"
                              >
                                Reopen
                              </button>
                            )}

                            {/* Cancel Action (for managers/owners on active non-completed orders) */}
                            {hasPermission(role, 'cancel_orders') && ord.status !== 'cancelled' && ord.status !== 'completed' && (
                              <button
                                type="button"
                                data-testid={`btn-order-cancel-${ord.id}`}
                                onClick={() => {
                                  setCancelOrderId(ord.id);
                                  setCancelReason('');
                                }}
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors flex items-center justify-center"
                                title="Cancel Order"
                              >
                                <Ban className="w-4 h-4" />
                              </button>
                            )}

                            {/* Delete Action (for owners/managers on any order) */}
                            {hasPermission(role, 'cancel_orders') && (
                              <button
                                type="button"
                                data-testid={`btn-order-delete-${ord.id}`}
                                onClick={() => {
                                  setDeleteOrderId(ord.id);
                                }}
                                className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors flex items-center justify-center"
                                title="Physically Delete Order"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

      </div>

      {/* Reopen Order Dialog */}
      {reopenOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-black text-slate-900">Reopen Order #{reopenOrderId}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Reopening will transition this completed order back to <strong>served</strong> to allow operational adjustments. Existing payments and historical logs will remain safely intact.
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Reason for Reopening:</label>
              <input
                type="text"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="e.g. Added item after bill, Customer dispute..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReopenOrderId(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="btn-confirm-reopen-order"
                disabled={isActionSubmitting}
                onClick={() => handleReopenOrder(reopenOrderId)}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors"
              >
                Confirm Reopen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Dialog */}
      {cancelOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-black text-slate-900">Cancel Order #{cancelOrderId.substring(0, 8)}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to cancel this order? This operation will reverse any kitchen stock consumption associated with this order.
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Reason for Cancellation:</label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Customer changed mind, Duplicate order..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCancelOrderId(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200"
              >
                No, Keep Order
              </button>
              <button
                type="button"
                data-testid="btn-confirm-cancel-order"
                disabled={isActionSubmitting}
                onClick={() => handleCancelOrder(cancelOrderId)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Order Dialog */}
      {deleteOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-black text-slate-900">Delete Order #{deleteOrderId.substring(0, 8)}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>WARNING:</strong> This will physically delete the order document from the database. This action is irreversible and should only be used to clean up invalid test orders.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteOrderId(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="btn-confirm-delete-order"
                disabled={isActionSubmitting}
                onClick={() => handleDeleteOrder(deleteOrderId)}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {/* Bill Receipt Modal */}
      {selectedBillOrder && (
        <BillReceiptModal
          isOpen={!!selectedBillOrder}
          onClose={() => setSelectedBillOrder(null)}
          order={selectedBillOrder}
          isReprint={isReprintMode}
          tableMap={tableMap}
        />
      )}

      {/* WhatsApp Bill Modal */}
      {whatsAppOrder && (
        <WhatsAppBillModal
          isOpen={!!whatsAppOrder}
          onClose={() => setWhatsAppOrder(null)}
          order={whatsAppOrder}
          tableMap={tableMap}
          isReprint={whatsAppOrder.status === 'completed'}
        />
      )}

      {/* Order Item Details Modal */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl max-w-xl w-full text-white shadow-2xl overflow-hidden my-0 sm:my-8 animate-in slide-in-from-bottom duration-200">
            <div className="p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-tight">
                    Order #{detailOrder.orderNumber || detailOrder.id.substring(0, 8)}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Type: <span className="capitalize font-bold text-slate-200">{detailOrder.orderType}</span> • Status:{' '}
                    <span className="capitalize font-bold text-slate-200">{detailOrder.status}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* Items Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Historical Item Snapshots</h4>
                <div className="space-y-2">
                  {detailOrder.items.map((it, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex justify-between items-center text-xs"
                    >
                      <div>
                        <div className="font-bold text-white">
                          {it.quantity}x {it.nameSnapshot}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Unit: {formatMoney(it.unitPriceMinor, symbol)} • Tax: {it.taxRate}%
                          {it.taxInclusive ? ' (incl)' : ' (excl)'}
                        </div>
                        {it.notes && <div className="text-[10px] text-amber-400 italic">Note: {it.notes}</div>}
                      </div>
                      <div className="text-right font-mono font-bold text-indigo-300">
                        {formatMoney(it.lineTotalMinor, symbol)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Financial Snapshot Breakdown */}
              <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal:</span>
                  <span className="font-mono text-white">{formatMoney(detailOrder.subtotalMinor ?? 0, symbol)}</span>
                </div>
                {(detailOrder.discountMinor || 0) > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Discount:</span>
                    <span className="font-mono">-{formatMoney(detailOrder.discountMinor ?? 0, symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-400">
                  <span>Taxable:</span>
                  <span className="font-mono text-white">{formatMoney(detailOrder.taxableAmountMinor ?? 0, symbol)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Total Tax (CGST+SGST+IGST):</span>
                  <span className="font-mono text-white">{formatMoney(detailOrder.totalTaxMinor ?? 0, symbol)}</span>
                </div>
                <div className="flex justify-between font-black text-sm text-white pt-2 border-t border-slate-800">
                  <span>Grand Total:</span>
                  <span className="font-mono text-indigo-400">{formatMoney(detailOrder.grandTotalMinor ?? 0, symbol)}</span>
                </div>
                <div className="flex justify-between text-emerald-400 pt-1 border-t border-slate-800/60 font-bold">
                  <span>Paid Amount:</span>
                  <span className="font-mono">{formatMoney(detailOrder.paidAmountMinor || 0, symbol)}</span>
                </div>
                {(detailOrder.dueAmountMinor || 0) > 0 && (
                  <div className="flex justify-between text-rose-400 font-bold">
                    <span>Due Amount:</span>
                    <span className="font-mono">{formatMoney(detailOrder.dueAmountMinor || 0, symbol)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              {Math.max(0, (detailOrder.grandTotalMinor || 0) - (detailOrder.paidAmountMinor || 0)) > 0 &&
                detailOrder.status !== 'cancelled' &&
                hasPermission(role, 'process_payments') && (
                  <button
                    type="button"
                    data-testid="btn-detail-receive-payment"
                    onClick={() => {
                      setReceivePaymentOrder(detailOrder);
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Receive Payment</span>
                  </button>
                )}

              <button
                type="button"
                onClick={() => {
                  setSelectedBillOrder(detailOrder);
                  setIsReprintMode(false);
                  setDetailOrder(null);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>View Full Bill</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Payment Modal */}
      {receivePaymentOrder && (
        <ReceivePaymentModal
          isOpen={Boolean(receivePaymentOrder)}
          onClose={() => setReceivePaymentOrder(null)}
          order={receivePaymentOrder}
          tableMap={tableMap}
          onPaymentSuccess={(updatedOrder) => {
            setActionSuccess(`Payment successfully recorded for Order #${updatedOrder.orderNumber || updatedOrder.id}.`);
            setTimeout(() => setActionSuccess(null), 4000);
            if (detailOrder && detailOrder.id === updatedOrder.id) {
              setDetailOrder(updatedOrder);
            }
            setReceivePaymentOrder(null);
            fetchOrderHistory(true);
          }}
        />
      )}
    </div>
  );
};

