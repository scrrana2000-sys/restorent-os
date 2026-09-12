import React, { useState, useEffect, useMemo } from 'react';
import { useRestaurant } from '../context/RestaurantContext';
import { useAuth } from '../context/AuthContext';
import { Payment, PaymentMethod, PaymentStatus } from '../types/payment';
import { Order } from '../types/order';
import { Table } from '../types/table';
import { paymentService } from '../services/paymentService';
import { orderService } from '../services/orderService';
import { tableService } from '../services/tableService';
import { formatMoney, fromMoneyMinor } from '../utils/money';
import { getFormattedTableLabel } from '../utils/tableLabel';
import { parseTimestampToMillis, formatTimestamp } from '../utils/dateUtils';
import { hasPermission } from '../utils/permissions';
import { ReceivePaymentModal } from '../components/pos/ReceivePaymentModal';
import { BillReceiptModal } from '../components/pos/BillReceiptModal';
import {
  CreditCard,
  Banknote,
  QrCode,
  MoreHorizontal,
  Search,
  Filter,
  RefreshCw,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Receipt,
  FileText,
  DollarSign,
  TrendingUp,
  Clock,
  ShieldAlert,
  ArrowUpDown,
  Plus
} from 'lucide-react';

type DateRangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

export const PaymentsPage: React.FC = () => {
  const { restaurant } = useRestaurant();
  const { user, profile } = useAuth();
  const symbol = restaurant?.currencySymbol || '₹';

  // Filters State
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Data State
  const [payments, setPayments] = useState<Payment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals State
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null);
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState<boolean>(false);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);

  // Refund Modal State
  const [refundPaymentTarget, setRefundPaymentTarget] = useState<Payment | null>(null);
  const [refundReason, setRefundReason] = useState<string>('');
  const [isRefunding, setIsRefunding] = useState<boolean>(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  // Quick Pay Modal (Order Selector)
  const [isOrderPickerOpen, setIsOrderPickerOpen] = useState<boolean>(false);
  const [orderPickerSearch, setOrderPickerSearch] = useState<string>('');

  const userRole = profile?.role || 'owner';
  const canRefund = hasPermission(userRole, 'refund_payments');
  const canReceivePayment = hasPermission(userRole, 'process_payments');

  // Real-time subscription to payments and orders
  useEffect(() => {
    if (!restaurant?.restaurantId) return;

    setLoading(true);
    setError(null);

    // Subscribe to payments
    const unsubscribePayments = paymentService.subscribeToPayments(
      restaurant.restaurantId,
      (livePayments) => {
        setPayments(livePayments);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to subscribe to payments:', err);
        setError('Failed to stream payment transactions from Firestore.');
        setLoading(false);
      }
    );

    // Subscribe to orders for order context
    const unsubscribeOrders = orderService.subscribeToOrders(
      restaurant.restaurantId,
      (liveOrders) => {
        setOrders(liveOrders);
      },
      (err) => {
        console.error('Failed to subscribe to orders:', err);
      }
    );

    // Subscribe to tables for human-readable labels
    const unsubscribeTables = tableService.subscribeToTables(
      restaurant.restaurantId,
      (liveTables) => {
        setTables(liveTables);
      },
      (err) => {
        console.warn('Failed to subscribe to tables in PaymentsPage:', err);
      }
    );

    return () => {
      unsubscribePayments();
      unsubscribeOrders();
      unsubscribeTables();
    };
  }, [restaurant?.restaurantId]);

  // Compute Date Bounds based on preset
  const dateBounds = useMemo<{ start: Date | null; end: Date | null }>(() => {
    const now = new Date();
    if (datePreset === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === 'yesterday') {
      const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const start = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0, 0);
      const end = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === 'week') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === 'custom') {
      const start = customStartDate ? new Date(customStartDate + 'T00:00:00') : null;
      const end = customEndDate ? new Date(customEndDate + 'T23:59:59.999') : null;
      return { start, end };
    }
    return { start: null, end: null };
  }, [datePreset, customStartDate, customEndDate]);

  // Table Map for fast human-readable label lookup
  const tableMap = useMemo(() => {
    const map = new Map<string, Table>();
    for (const t of tables) {
      map.set(t.id, t);
    }
    return map;
  }, [tables]);

  // Order Map for fast lookup
  const orderMap = useMemo(() => {
    const map = new Map<string, Order>();
    for (const o of orders) {
      map.set(o.id, o);
    }
    return map;
  }, [orders]);

  // Filtered Payments
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      // If we have loaded orders and this payment's order is not found, filter it out (it was deleted)
      if (orders.length > 0 && !orderMap.has(p.orderId)) {
        return false;
      }

      // Date filter
      if (dateBounds.start) {
        const startMillis = dateBounds.start.getTime();
        const pMillis = parseTimestampToMillis(p.createdAt);
        if (pMillis < startMillis) return false;
      }
      if (dateBounds.end) {
        const endMillis = dateBounds.end.getTime();
        const pMillis = parseTimestampToMillis(p.createdAt);
        if (pMillis > endMillis) return false;
      }

      // Method filter
      if (methodFilter !== 'all' && p.method !== methodFilter) {
        return false;
      }

      // Status filter
      if (statusFilter !== 'all' && p.status !== statusFilter) {
        return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const idMatch = p.id.toLowerCase().includes(q);
        const orderIdMatch = p.orderId.toLowerCase().includes(q);
        const refMatch = p.reference ? p.reference.toLowerCase().includes(q) : false;
        const actorMatch = p.createdBy ? p.createdBy.toLowerCase().includes(q) : false;
        const refundActorMatch = p.refundedBy ? p.refundedBy.toLowerCase().includes(q) : false;
        const refundReasonMatch = p.refundReason ? p.refundReason.toLowerCase().includes(q) : false;
        
        // Also match related order number
        const relatedOrder = orderMap.get(p.orderId);
        const orderNumMatch = relatedOrder?.orderNumber ? relatedOrder.orderNumber.toLowerCase().includes(q) : false;

        if (!idMatch && !orderIdMatch && !refMatch && !actorMatch && !refundActorMatch && !refundReasonMatch && !orderNumMatch) {
          return false;
        }
      }

      return true;
    });
  }, [payments, dateBounds, methodFilter, statusFilter, searchQuery, orderMap]);

  // Filtered Orders in date range to calculate Total Billed and Outstanding
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (o.status === 'cancelled') return false;
      if (dateBounds.start) {
        const startMillis = dateBounds.start.getTime();
        const oMillis = parseTimestampToMillis(o.createdAt);
        if (oMillis < startMillis) return false;
      }
      if (dateBounds.end) {
        const endMillis = dateBounds.end.getTime();
        const oMillis = parseTimestampToMillis(o.createdAt);
        if (oMillis > endMillis) return false;
      }
      return true;
    });
  }, [orders, dateBounds]);

  // Aggregate authoritative KPIs
  const kpis = useMemo(() => {
    let totalBilledMinor = 0;
    let totalOutstandingMinor = 0;

    for (const o of filteredOrders) {
      totalBilledMinor += o.grandTotalMinor || 0;
      totalOutstandingMinor += Math.max(0, (o.grandTotalMinor || 0) - (o.paidAmountMinor || 0));
    }

    let totalCollectedMinor = 0;
    let totalRefundedMinor = 0;
    let totalPendingMinor = 0;

    for (const p of filteredPayments) {
      if (p.status === 'completed') {
        totalCollectedMinor += p.amountMinor || 0;
      } else if (p.status === 'refunded') {
        totalRefundedMinor += p.amountMinor || 0;
      } else if (p.status === 'pending') {
        totalPendingMinor += p.amountMinor || 0;
      }
    }

    return {
      totalBilledMinor,
      totalCollectedMinor,
      totalRefundedMinor,
      totalOutstandingMinor,
      totalPendingMinor,
      paymentCount: filteredPayments.length
    };
  }, [filteredOrders, filteredPayments]);

  // Orders with outstanding due for Quick Pay picker
  const ordersWithDue = useMemo(() => {
    return orders.filter((o) => {
      if (o.status === 'cancelled') return false;
      const due = Math.max(0, (o.grandTotalMinor || 0) - (o.paidAmountMinor || 0));
      if (due <= 0) return false;
      if (orderPickerSearch.trim()) {
        const q = orderPickerSearch.trim().toLowerCase();
        const numMatch = (o.orderNumber || '').toLowerCase().includes(q);
        const custMatch = (o.customerSnapshot?.name || '').toLowerCase().includes(q);
        const tableMatch = (o.tableId || '').toLowerCase().includes(q);
        return numMatch || custMatch || tableMatch;
      }
      return true;
    });
  }, [orders, orderPickerSearch]);

  const handleOpenRefundModal = (payment: Payment) => {
    setRefundPaymentTarget(payment);
    setRefundReason('');
    setRefundError(null);
  };

  const handleExecuteRefund = async () => {
    if (!refundPaymentTarget || !restaurant?.restaurantId) return;

    setIsRefunding(true);
    setRefundError(null);

    try {
      await paymentService.refundPayment(
        restaurant.restaurantId,
        refundPaymentTarget.id,
        user?.uid || 'staff',
        refundReason.trim() || 'Refunded by authorized staff'
      );

      setRefundPaymentTarget(null);
      setRefundReason('');
    } catch (err: any) {
      console.error('Refund failed:', err);
      setRefundError(err.message || 'Refund processing failed.');
    } finally {
      setIsRefunding(false);
    }
  };

  const renderMethodBadge = (method: PaymentMethod) => {
    switch (method) {
      case 'cash':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Banknote className="w-3.5 h-3.5" />
            <span>Cash</span>
          </span>
        );
      case 'upi':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <QrCode className="w-3.5 h-3.5" />
            <span>UPI / QR</span>
          </span>
        );
      case 'card':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
            <CreditCard className="w-3.5 h-3.5" />
            <span>Card</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <MoreHorizontal className="w-3.5 h-3.5" />
            <span>Other</span>
          </span>
        );
    }
  };

  const renderStatusBadge = (status: PaymentStatus, refundReason?: string | null) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" />
            <span>Completed</span>
          </span>
        );
      case 'refunded':
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-purple-50 text-purple-700 border border-purple-200">
              <RotateCcw className="w-3 h-3" />
              <span>Refunded</span>
            </span>
            {refundReason && (
              <span className="text-[10px] text-slate-500 italic truncate max-w-[120px]" title={refundReason}>
                {refundReason}
              </span>
            )}
          </div>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3" />
            <span>Pending</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-600 shadow-xs">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Payment Transactions & History</h1>
              <p className="text-xs text-slate-500 font-medium">
                Authoritative settlement records, split tenders, and financial payment audit trail
              </p>
            </div>
          </div>
        </div>

        {/* Quick Action: Receive Payment */}
        {canReceivePayment && (
          <button
            id="open-receive-payment-btn"
            onClick={() => setIsOrderPickerOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Receive Payment</span>
          </button>
        )}
      </div>

      {/* KPI Financial Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TOTAL BILLED */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Billed</span>
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-7 w-24 bg-slate-200 animate-pulse rounded-md" />
            ) : (
              <span className="text-2xl font-black text-slate-900 tracking-tight">
                {formatMoney(kpis.totalBilledMinor, symbol)}
              </span>
            )}
            <p className="text-[11px] text-slate-400 mt-0.5">Sum of confirmed orders</p>
          </div>
        </div>

        {/* TOTAL COLLECTED / PAID */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total Collected</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-7 w-24 bg-slate-200 animate-pulse rounded-md" />
            ) : (
              <span className="text-2xl font-black text-emerald-600 tracking-tight">
                {formatMoney(kpis.totalCollectedMinor, symbol)}
              </span>
            )}
            <p className="text-[11px] text-emerald-600/80 mt-0.5">Settled payment transactions</p>
          </div>
        </div>

        {/* TOTAL OUTSTANDING */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Outstanding Due</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-7 w-24 bg-slate-200 animate-pulse rounded-md" />
            ) : (
              <span className="text-2xl font-black text-rose-600 tracking-tight">
                {formatMoney(kpis.totalOutstandingMinor, symbol)}
              </span>
            )}
            <p className="text-[11px] text-rose-600/80 mt-0.5">Pending uncollected balances</p>
          </div>
        </div>

        {/* NUMBER OF TRANSACTIONS */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">Transactions</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-7 w-16 bg-slate-200 animate-pulse rounded-md" />
            ) : (
              <span className="text-2xl font-black text-indigo-600 tracking-tight">
                {kpis.paymentCount}
              </span>
            )}
            <p className="text-[11px] text-slate-400 mt-0.5">
              {kpis.totalRefundedMinor > 0 ? `Includes ${formatMoney(kpis.totalRefundedMinor, symbol)} refunded` : 'Recorded transactions'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Date Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {(['today', 'yesterday', 'week', 'month', 'all', 'custom'] as DateRangePreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => setDatePreset(preset)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap capitalize ${
                  datePreset === preset
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
                }`}
              >
                {preset === 'week' ? 'Last 7 Days' : preset === 'month' ? 'This Month' : preset}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, Order #, Note..."
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900"
            />
          </div>
        </div>

        {/* Custom Date Pickers */}
        {datePreset === 'custom' && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">From:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-800"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">To:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-800"
              />
            </div>
          </div>
        )}

        {/* Secondary Filter Dropdowns */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs">
          {/* Method Filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">Method:</span>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as any)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 font-bold text-slate-800"
            >
              <option value="all">All Methods</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI / QR</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 font-bold text-slate-800"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="refunded">Refunded</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {/* Reset Filters Shortcut */}
          {(methodFilter !== 'all' || statusFilter !== 'all' || searchQuery.trim() !== '' || datePreset !== 'all') && (
            <button
              onClick={() => {
                setMethodFilter('all');
                setStatusFilter('all');
                setSearchQuery('');
                setDatePreset('all');
              }}
              className="ml-auto text-indigo-600 hover:text-indigo-800 font-bold text-xs flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Payment Transactions Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
        {error ? (
          <div className="p-12 text-center text-rose-600 space-y-3" data-testid="payments-error-state">
            <AlertCircle className="w-10 h-10 mx-auto text-rose-500" />
            <h3 className="text-sm font-bold text-rose-800">Error Loading Payment Transactions</h3>
            <p className="text-xs text-rose-600 max-w-sm mx-auto font-medium">
              {error}
            </p>
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
              }}
              className="mt-2 px-4 py-2 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-500" />
            <p className="text-xs font-semibold">Streaming authoritative payment records...</p>
          </div>
        ) : filteredPayments.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <CreditCard className="w-10 h-10 mx-auto text-slate-300" />
            <h3 className="text-sm font-bold text-slate-700">No payment transactions found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              No transactions match the selected filters. Try changing your date range or filters.
            </p>
            {datePreset !== 'all' && (
              <button
                onClick={() => setDatePreset('all')}
                className="mt-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-xs font-bold transition-colors"
              >
                View All Transactions
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile View: High-density touch-optimized transaction cards */}
            <div className="block md:hidden divide-y divide-slate-100 p-3 space-y-3">
              {filteredPayments.map((p) => {
                const dt = formatTimestamp(p.createdAt);
                const relatedOrder = orderMap.get(p.orderId);

                return (
                  <div
                    key={`mobile-pay-${p.id}`}
                    className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-xs space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-slate-900">
                            {p.id.length > 14 ? `${p.id.substring(0, 14)}...` : p.id}
                          </span>
                          {p.reference && (
                            <span className="text-[10px] text-slate-400 truncate max-w-[110px]" title={p.reference}>
                              ({p.reference})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {dt.dateStr} • {dt.timeStr}
                        </div>
                      </div>
                      <div>{renderStatusBadge(p.status, p.refundReason)}</div>
                    </div>

                    <div className="flex items-center justify-between py-2 border-y border-slate-100 text-xs">
                      <div>
                        {relatedOrder ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              onClick={() => setReceiptOrder(relatedOrder)}
                              className="font-bold text-indigo-600 cursor-pointer"
                            >
                              #{relatedOrder.orderNumber}
                            </span>
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-600 font-medium">
                              {getFormattedTableLabel(relatedOrder, tableMap)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] text-slate-500">
                            Order: {p.orderId.substring(0, 8)}...
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {renderMethodBadge(p.method)}
                        <span
                          className={`text-sm font-black ${
                            p.status === 'refunded' ? 'text-purple-700 line-through' : 'text-slate-900'
                          }`}
                        >
                          {formatMoney(p.amountMinor, symbol)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400 truncate max-w-[120px]">
                        By {p.createdBy || 'Staff'}
                      </span>
                      <div className="flex items-center gap-2">
                        {relatedOrder && (
                          <button
                            type="button"
                            onClick={() => setReceiptOrder(relatedOrder)}
                            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-100 flex items-center gap-1.5 active:scale-95 transition-all"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Receipt</span>
                          </button>
                        )}
                        {canRefund && p.status === 'completed' && (
                          <button
                            type="button"
                            onClick={() => handleOpenRefundModal(p)}
                            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-purple-50 text-purple-700 text-xs font-bold border border-purple-200 flex items-center gap-1.5 active:scale-95 transition-all"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Refund</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Transaction / Ref</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Order Details</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Staff / Actor</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredPayments.map((p) => {
                  const dt = formatTimestamp(p.createdAt);
                  const relatedOrder = orderMap.get(p.orderId);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Transaction ID & Ref */}
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-800">
                        <div className="font-bold truncate max-w-[120px]" title={p.id}>
                          {p.id}
                        </div>
                        {p.reference && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[140px] font-sans" title={p.reference}>
                            {p.reference}
                          </div>
                        )}
                      </td>

                      {/* Date & Time */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{dt.dateStr}</div>
                        <div className="text-[10px] text-slate-400">{dt.timeStr}</div>
                      </td>

                      {/* Order Details */}
                      <td className="py-3.5 px-4">
                        {relatedOrder ? (
                          <div>
                            <span className="font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer" onClick={() => setReceiptOrder(relatedOrder)}>
                              #{relatedOrder.orderNumber}
                            </span>
                            <p className="text-[10px] text-slate-400">
                              {getFormattedTableLabel(relatedOrder, tableMap)}
                            </p>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] text-slate-500">
                            {p.orderId.substring(0, 8)}...
                          </span>
                        )}
                      </td>

                      {/* Method */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {renderMethodBadge(p.method)}
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`text-sm font-black ${
                          p.status === 'refunded' ? 'text-purple-700 line-through' : 'text-slate-900'
                        }`}>
                          {formatMoney(p.amountMinor, symbol)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {renderStatusBadge(p.status, p.refundReason)}
                      </td>

                      {/* Staff Actor */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-500">
                        <div className="truncate max-w-[100px]" title={p.createdBy}>
                          {p.createdBy || 'Staff'}
                        </div>
                        {p.refundedBy && (
                          <div className="text-[10px] text-purple-600 truncate max-w-[100px]" title={`Refunded by ${p.refundedBy}`}>
                            Ref by: {p.refundedBy}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {relatedOrder && (
                            <button
                              onClick={() => setReceiptOrder(relatedOrder)}
                              title="View Bill / Receipt"
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          )}

                          {canRefund && p.status === 'completed' && (
                            <button
                              onClick={() => handleOpenRefundModal(p)}
                              title="Issue Refund"
                              className="px-2 py-1 rounded-lg text-[11px] font-bold text-purple-700 hover:bg-purple-50 border border-purple-200 transition-colors flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Refund</span>
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

      {/* Quick Pay / Order Picker Modal */}
      {isOrderPickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Receive Payment Against Order</h3>
                <p className="text-xs text-slate-400">Select an active order with an outstanding due balance</p>
              </div>
              <button
                onClick={() => setIsOrderPickerOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={orderPickerSearch}
                  onChange={(e) => setOrderPickerSearch(e.target.value)}
                  placeholder="Filter by Order #, Customer, Table..."
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl">
                {ordersWithDue.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs font-semibold">
                    No orders with outstanding balance found.
                  </div>
                ) : (
                  ordersWithDue.map((ord) => {
                    const due = Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
                    return (
                      <div
                        key={ord.id}
                        className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs">#{ord.orderNumber}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase bg-slate-100 text-slate-600">
                              {ord.orderType}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {ord.customerSnapshot?.name || 'Walk-in Guest'} • {getFormattedTableLabel(ord, tableMap)} • Total: {formatMoney(ord.grandTotalMinor, symbol)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-[10px] text-rose-600 font-bold uppercase block">Due</span>
                            <span className="text-sm font-black text-rose-600">{formatMoney(due, symbol)}</span>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedOrderForPayment(ord);
                              setIsOrderPickerOpen(false);
                              setIsReceivePaymentOpen(true);
                            }}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
                          >
                            Pay Due
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 text-right">
              <button
                onClick={() => setIsOrderPickerOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Payment Modal */}
      {isReceivePaymentOpen && selectedOrderForPayment && (
        <ReceivePaymentModal
          isOpen={isReceivePaymentOpen}
          onClose={() => {
            setIsReceivePaymentOpen(false);
            setSelectedOrderForPayment(null);
          }}
          order={selectedOrderForPayment}
          tableMap={tableMap}
          onPaymentSuccess={(updatedOrder) => {
            setIsReceivePaymentOpen(false);
            setSelectedOrderForPayment(null);
          }}
        />
      )}

      {/* Refund Confirmation Modal */}
      {refundPaymentTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-5 bg-purple-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <RotateCcw className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">Refund Payment</h3>
              </div>
              <button
                onClick={() => setRefundPaymentTarget(null)}
                className="p-1 text-purple-300 hover:text-white rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-purple-50 border border-purple-200/80 rounded-2xl p-4 text-xs text-purple-900 space-y-2">
                <div className="flex justify-between">
                  <span>Payment Amount</span>
                  <span className="font-bold text-sm text-purple-950">
                    {formatMoney(refundPaymentTarget.amountMinor, symbol)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Method</span>
                  <span className="font-bold capitalize">{refundPaymentTarget.method}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payment ID</span>
                  <span className="font-mono text-[10px]">{refundPaymentTarget.id}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Reason for Refund (Optional)
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="e.g. Customer change of mind, wrong tender"
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                />
              </div>

              {refundError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{refundError}</span>
                </div>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Refunding will mark this payment as refunded, deduct the refunded amount from the order's paid total, and log an audit trail event.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setRefundPaymentTarget(null)}
                disabled={isRefunding}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRefund}
                disabled={isRefunding}
                className="px-5 py-2 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
              >
                {isRefunding && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Refund ({formatMoney(refundPaymentTarget.amountMinor, symbol)})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill Receipt Modal */}
      {receiptOrder && (
        <BillReceiptModal
          isOpen={Boolean(receiptOrder)}
          onClose={() => setReceiptOrder(null)}
          order={receiptOrder}
          tableMap={tableMap}
        />
      )}
    </div>
  );
};
