import React, { useState, useEffect, useMemo } from 'react';
import { Order, OrderType } from '../../types/order';
import { Table } from '../../types/table';
import { tableService } from '../../services/tableService';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { orderService } from '../../services/orderService';
import { hasPermission } from '../../utils/permissions';
import { formatMoney } from '../../utils/money';
import {
  CreditCard,
  Search,
  X,
  AlertCircle,
  RefreshCw,
  Utensils,
  ShoppingBag,
  Truck,
  User,
  Clock,
  DollarSign,
  CheckCircle2,
  ChevronRight,
  WifiOff,
  Ban
} from 'lucide-react';

export interface PaymentDueCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onCollectPayment: (order: Order) => void;
  symbol?: string;
  isOffline?: boolean;
  tables?: Table[];
  restaurantId?: string;
}

export { getFormattedTableLabel } from '../../utils/tableLabel';
import { getFormattedTableLabel } from '../../utils/tableLabel';

export const PaymentDueCenterModal: React.FC<PaymentDueCenterModalProps> = ({
  isOpen,
  onClose,
  orders,
  loading,
  error,
  onRetry,
  onCollectPayment,
  symbol = '₹',
  isOffline = false,
  tables: tablesProp,
  restaurantId: propRestaurantId
}) => {
  let activeRestaurantId = propRestaurantId || '';
  try {
    const { restaurant } = useRestaurant();
    if (!activeRestaurantId && restaurant?.restaurantId) {
      activeRestaurantId = restaurant.restaurantId;
    }
  } catch {
    // Safe fallback when component is rendered in unit tests without RestaurantProvider
  }

  let user: any = null;
  let profile: any = null;
  try {
    const authContext = useAuth();
    user = authContext.user;
    profile = authContext.profile;
  } catch {
    // Safe fallback when component is rendered in unit tests without AuthProvider
  }
  const role = profile?.role || 'staff';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<OrderType | 'all'>('all');
  const [localTables, setLocalTables] = useState<Table[]>([]);

  // Cancellation state
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancelOrder = async (orderId: string) => {
    if (!activeRestaurantId || !user?.uid) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      await orderService.updateOrderStatus(
        activeRestaurantId,
        orderId,
        'cancelled',
        user.uid,
        cancelReason || 'Cancelled from Payment Due Center'
      );
      setCancelOrderId(null);
      setCancelReason('');
    } catch (err: any) {
      setCancelError(err?.message || 'Failed to cancel order.');
    } finally {
      setIsCancelling(false);
    }
  };

  // Realtime subscription to restaurant tables when modal is open (0 N+1 reads)
  useEffect(() => {
    if (!isOpen || !activeRestaurantId) return;
    if (tablesProp && tablesProp.length > 0) return;

    const unsubscribe = tableService.subscribeToTables(
      activeRestaurantId,
      (updatedTables) => {
        setLocalTables(updatedTables);
      },
      (err) => {
        console.warn('[PaymentDueCenterModal] Tables subscription warning:', err);
      }
    );

    return () => unsubscribe();
  }, [isOpen, activeRestaurantId, tablesProp]);

  // Lookup map for fast authoritative table resolution
  const tableMap = useMemo(() => {
    const map = new Map<string, Table>();
    const sourceTables = tablesProp && tablesProp.length > 0 ? tablesProp : localTables;
    for (const t of sourceTables) {
      if (t.id) map.set(t.id, t);
      if (t.tableNumber) map.set(t.tableNumber, t);
    }
    return map;
  }, [tablesProp, localTables]);

  // Filter orders by order type and search query
  const filteredOrders = useMemo(() => {
    return orders.filter((ord) => {
      // Type filter
      if (selectedType !== 'all') {
        const isDineInMatch = selectedType === 'dineIn' && (ord.orderType === 'dineIn' || (ord.orderType as any) === 'dine_in');
        const isTypeMatch = ord.orderType === selectedType || isDineInMatch;
        if (!isTypeMatch) return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesNum = ord.orderNumber?.toString().toLowerCase().includes(query);

        const tableLabel = getFormattedTableLabel(ord, tableMap).toLowerCase();
        const tableNum = tableMap.get(ord.tableId || '')?.tableNumber?.toLowerCase();
        const tableName = tableMap.get(ord.tableId || '')?.name?.toLowerCase();

        const matchesTable = tableLabel.includes(query) ||
          (tableNum ? tableNum.includes(query) : false) ||
          (tableName ? tableName.includes(query) : false);

        const matchesCustomer = ord.customerSnapshot?.name?.toLowerCase().includes(query) ||
          ord.customerSnapshot?.phone?.includes(query);
        const matchesItem = ord.items?.some(i => i.nameSnapshot.toLowerCase().includes(query));

        return matchesNum || matchesTable || matchesCustomer || matchesItem;
      }

      return true;
    });
  }, [orders, selectedType, searchQuery, tableMap]);

  // Aggregate totals
  const totalDueMinor = useMemo(() => {
    return orders.reduce((sum, ord) => {
      const due = ord.dueAmountMinor ?? Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
      return sum + due;
    }, 0);
  }, [orders]);

  if (!isOpen) return null;

  return (
    <div
      id="payment-due-modal"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden border border-slate-200 animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 flex flex-col max-h-[92vh] max-h-dvh-screen pb-safe">
        {/* Header */}
        <div className="p-3 sm:p-5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-lg font-bold text-white tracking-tight leading-tight">
                  Payment Due Center
                </h2>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] sm:text-[11px] font-black bg-amber-500 text-slate-950 whitespace-nowrap">
                  {orders.length} {orders.length === 1 ? 'Order' : 'Orders'}
                </span>
              </div>
              <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 leading-tight">
                <span>Total Outstanding:</span>
                <span className="font-bold text-amber-400 font-mono">
                  {formatMoney(totalDueMinor, symbol)}
                </span>
              </p>
            </div>
          </div>

          <button
            id="close-payment-due-modal-btn"
            type="button"
            onClick={onClose}
            className="w-8 h-8 sm:w-9 sm:h-9 text-slate-400 hover:text-white rounded-lg sm:rounded-xl hover:bg-slate-800 flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Offline Warning Banner */}
        {isOffline && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2 text-xs text-amber-700 font-medium">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Working Offline — Displaying cached payment due records.</span>
          </div>
        )}

        {/* Search & Filter Controls */}
        <div className="p-2.5 sm:p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-2 shrink-0">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by order #, table, or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 sm:h-10 pl-8 pr-8 text-[11px] sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="w-8 h-8 absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 flex items-center justify-center rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Type Filter Tabs */}
          <div className="grid grid-cols-4 items-center bg-slate-200/80 p-1 rounded-lg sm:rounded-xl gap-1 shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setSelectedType('all')}
              className={`h-8 min-w-0 px-1.5 sm:px-3 rounded-md sm:rounded-lg text-[9px] sm:text-xs font-bold transition-all whitespace-nowrap flex items-center justify-center ${
                selectedType === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setSelectedType('dineIn')}
              className={`h-8 min-w-0 flex items-center justify-center gap-1 px-1 sm:px-3 rounded-md sm:rounded-lg text-[9px] sm:text-xs font-bold transition-all whitespace-nowrap ${
                selectedType === 'dineIn'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Utensils className="w-3.5 h-3.5 text-indigo-600" />
              <span>Dine-In</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedType('takeaway')}
              className={`h-8 flex items-center gap-1.5 px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                selectedType === 'takeaway'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
              <span>Takeaway</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedType('delivery')}
              className={`h-8 flex items-center gap-1.5 px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                selectedType === 'delivery'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className="w-3.5 h-3.5 text-amber-600" />
              <span>Delivery</span>
            </button>
          </div>
        </div>

        {/* Modal Body / Orders List */}
        <div className="p-2.5 sm:p-5 overflow-y-auto space-y-2.5 sm:space-y-3 flex-1 bg-slate-100/60">
          {/* Error State */}
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-3 my-4">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-red-900">Unable to load payment dues</h3>
                <p className="text-xs text-red-700 mt-1">{error}</p>
              </div>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="h-11 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors shadow-xs active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          ) : loading ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Checking outstanding payment dues...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-12 text-center space-y-3 bg-white rounded-2xl border border-slate-200 p-8 my-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">No Pending Payments</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {searchQuery || selectedType !== 'all'
                    ? 'No outstanding orders match your search criteria.'
                    : 'All orders have been fully paid and settled!'}
                </p>
              </div>
            </div>
          ) : (
            filteredOrders.map((ord) => {
              const dueMinor = ord.dueAmountMinor ?? Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
              const isServed = ord.status === 'served';
              const isReady = ord.status === 'ready';

              return (
                <div
                  key={ord.id}
                  className={`bg-white rounded-xl sm:rounded-2xl p-2.5 sm:p-4 border transition-all shadow-xs hover:shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3.5 ${
                    isServed || isReady
                      ? 'border-amber-400/80 bg-gradient-to-r from-amber-50/40 via-white to-white'
                      : 'border-slate-200'
                  }`}
                >
                  {/* Left Column: Order details */}
                  <div className="space-y-1.5 sm:space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span className="text-xs sm:text-sm font-extrabold text-slate-900">
                        #{ord.orderNumber}
                      </span>

                      {/* Order Type Badge */}
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 sm:px-2.5 py-0.5 rounded-md sm:rounded-lg text-[9px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
                          ord.orderType === 'dineIn' || (ord.orderType as any) === 'dine_in'
                            ? 'bg-indigo-100 text-indigo-800'
                            : ord.orderType === 'takeaway'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {ord.orderType === 'dineIn' || (ord.orderType as any) === 'dine_in' ? (
                          <>
                            <Utensils className="w-3 h-3" />
                            <span>{getFormattedTableLabel(ord, tableMap)}</span>
                          </>
                        ) : ord.orderType === 'takeaway' ? (
                          <>
                            <ShoppingBag className="w-3 h-3" />
                            <span>TAKEAWAY / PARCEL</span>
                          </>
                        ) : (
                          <>
                            <Truck className="w-3 h-3" />
                            <span>DELIVERY</span>
                          </>
                        )}
                      </span>

                      {/* Operational Status Pill */}
                      <span
                        className={`px-1.5 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide border whitespace-nowrap ${
                          isServed
                            ? 'bg-amber-500/15 text-amber-800 border-amber-300 animate-pulse'
                            : isReady
                            ? 'bg-emerald-500/15 text-emerald-800 border-emerald-300'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {isServed
                          ? 'SERVED • DUE'
                          : isReady
                          ? 'READY • DUE'
                          : `${ord.status.toUpperCase()} • DUE`}
                      </span>
                    </div>

                    {/* Additional Metadata: Customer & Items */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-slate-500 leading-tight">
                      {ord.customerSnapshot?.name && (
                        <span className="flex items-center gap-1 text-slate-700 font-medium">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span className="truncate max-w-[140px]">{ord.customerSnapshot.name}</span>
                        </span>
                      )}

                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="whitespace-nowrap">
                          {ord.createdAt
                            ? new Date(
                                (ord.createdAt as any)?.toMillis?.() || ord.createdAt
                              ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Just now'}
                        </span>
                      </span>

                      <span className="whitespace-nowrap">
                        {ord.items?.length || 0} {ord.items?.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>

                    {/* Item list summary */}
                    {ord.items && ord.items.length > 0 && (
                      <p className="text-xs text-slate-600 line-clamp-1 italic bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                        {ord.items.map((i) => `${i.nameSnapshot} x${i.quantity}`).join(', ')}
                      </p>
                    )}
                  </div>

                  {/* Right Column: Financial Breakdown & Collect Action */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                    <div className="text-left sm:text-right space-y-0.5">
                      <div className="flex items-center sm:justify-end gap-1.5 text-xs text-slate-500 leading-tight">
                        <span className="whitespace-nowrap">Total: {formatMoney(ord.grandTotalMinor, symbol)}</span>
                        <span>•</span>
                        <span className="whitespace-nowrap">Paid: {formatMoney(ord.paidAmountMinor || 0, symbol)}</span>
                      </div>
                      <div className="text-sm sm:text-base font-black text-amber-600 flex items-center sm:justify-end gap-1 leading-tight">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Due:</span>
                        <span className="font-mono">{formatMoney(dueMinor, symbol)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Cancel Order Action */}
                      {hasPermission(role, 'cancel_orders') && (
                        <button
                          type="button"
                          onClick={() => {
                            setCancelOrderId(ord.id);
                            setCancelReason('');
                            setCancelError(null);
                          }}
                          className="h-9 sm:h-10 min-h-0 flex-1 sm:flex-none px-2.5 sm:px-3 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 shrink-0 whitespace-nowrap active:scale-95"
                          title="Cancel Order"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Cancel</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onCollectPayment(ord)}
                        className="h-9 sm:h-10 min-h-0 flex-1 sm:flex-none px-2.5 sm:px-4 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 active:bg-indigo-800 transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap active:scale-95"
                      >
                        <CreditCard className="w-4 h-4" />
                        <span>Collect Payment</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] sm:text-xs text-slate-500 shrink-0">
          <span className="hidden sm:inline">Realtime Payment Due Collection Center</span>
          <span className="sm:hidden text-slate-400 font-medium">Payment Due Center</span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 sm:h-10 min-h-0 px-4 sm:px-5 bg-slate-200 text-slate-800 font-bold rounded-xl hover:bg-slate-300 transition-colors flex items-center justify-center active:scale-95"
          >
            Close
          </button>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 text-slate-950">
            <h3 className="text-base font-black text-slate-900">Cancel Order #{cancelOrderId.substring(0, 8)}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to cancel this order? This will release the table session and reverse inventory stock deductions.
            </p>
            {cancelError && (
              <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl font-medium border border-rose-200">
                {cancelError}
              </div>
            )}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Reason for Cancellation:</label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Guest walked out, Duplicate entry..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isCancelling}
                onClick={() => setCancelOrderId(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200"
              >
                No, Keep Order
              </button>
              <button
                type="button"
                disabled={isCancelling}
                onClick={() => handleCancelOrder(cancelOrderId)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors flex items-center gap-1.5"
              >
                {isCancelling && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Cancel</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
