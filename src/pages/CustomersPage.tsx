import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Search,
  Filter,
  RefreshCw,
  UserCheck,
  ShieldCheck,
  User,
  ShoppingBag,
  Clock,
  Phone,
  Mail,
  ChevronRight,
  Receipt,
  TrendingUp,
  CreditCard,
  AlertCircle
} from 'lucide-react';
import { useRestaurant } from '../context/RestaurantContext';
import { useAuth } from '../context/AuthContext';
import { restaurantCustomerService } from '../services/restaurantCustomerService';
import {
  RestaurantCustomer,
  RestaurantCustomerSummaryMetrics,
  CustomerCategoryFilter
} from '../types/restaurantCustomer';
import { CustomerDetailModal } from '../components/customers/CustomerDetailModal';
import { formatMoney } from '../utils/money';

export interface CustomersPageProps {
  onNavigateToOrders?: (orderId?: string) => void;
}

export const CustomersPage: React.FC<CustomersPageProps> = ({ onNavigateToOrders }) => {
  const { restaurant } = useRestaurant();
  const { profile } = useAuth();
  const restaurantId = restaurant?.restaurantId || (restaurant as any)?.id;
  const currencySymbol = restaurant?.currencySymbol || '₹';

  // State
  const [customers, setCustomers] = useState<RestaurantCustomer[]>([]);
  const [metrics, setMetrics] = useState<RestaurantCustomerSummaryMetrics>({
    totalCustomers: 0,
    registeredCustomersCount: 0,
    guestCustomersCount: 0,
    totalOrders: 0,
    totalRevenueMinor: 0,
    averageOrderValueMinor: 0
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<CustomerCategoryFilter>('all');

  // Selected customer for modal
  const [selectedCustomer, setSelectedCustomer] = useState<RestaurantCustomer | null>(null);

  const loadCustomerData = useCallback(
    async (isManualRefresh = false) => {
      if (!restaurantId) return;
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const result = await restaurantCustomerService.getRestaurantCustomers(restaurantId, {
          searchQuery,
          categoryFilter: activeCategory
        });
        setCustomers(result.customers);
        setMetrics(result.metrics);
      } catch (err: any) {
        console.error('[CustomersPage] Failed to load restaurant customers:', err);
        setError(err.message || 'Failed to load customers. Please try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [restaurantId, searchQuery, activeCategory]
  );

  useEffect(() => {
    loadCustomerData();
  }, [loadCustomerData]);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const handleOpenOrder = (orderId: string) => {
    if (onNavigateToOrders) {
      onNavigateToOrders(orderId);
    }
  };

  return (
    <div id="restaurant-customers-page" className="space-y-6 animate-fade-in p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-200">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Customers & CRM</h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Manage restaurant customer directory and review order activity history.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="refresh-customers-btn"
            type="button"
            onClick={() => loadCustomerData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-xs transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-indigo-600' : 'text-slate-500'}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Unique Customers
            </span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2">{metrics.totalCustomers}</p>
          <div className="flex items-center gap-2 text-xs text-slate-600 mt-1">
            <span className="text-indigo-700 font-semibold">{metrics.registeredCustomersCount} registered</span>
            <span>·</span>
            <span>{metrics.guestCustomersCount} guest entries</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Total Customer Orders
            </span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2">{metrics.totalOrders}</p>
          <p className="text-xs text-slate-600 mt-1">Orders placed at this restaurant</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Total Customer Spend
            </span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2">
            {formatMoney(metrics.totalRevenueMinor, currencySymbol)}
          </p>
          <p className="text-xs text-slate-600 mt-1">Net non-cancelled orders</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Avg. Order Value
            </span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2">
            {formatMoney(metrics.averageOrderValueMinor, currencySymbol)}
          </p>
          <p className="text-xs text-slate-600 mt-1">Per transaction average</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="customer-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, email, phone, or UID..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-600"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/60">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeCategory === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({metrics.totalCustomers})
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('registered')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeCategory === 'registered'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Registered ({metrics.registeredCustomersCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('guest')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeCategory === 'guest'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Guest Activity ({metrics.guestCustomersCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('multi_order')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeCategory === 'multi_order'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              2+ Orders
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('recent')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeCategory === 'recent'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 30 Days
            </button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Unable to fetch customer data</p>
            <p className="text-xs text-rose-600 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => loadCustomerData(true)}
            className="text-xs font-bold underline hover:no-underline text-rose-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Customer Directory Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">Loading restaurant customer records...</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600 mx-auto mb-3">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No customer records found</h3>
            <p className="text-sm text-slate-600 max-w-md mx-auto mt-1">
              {searchQuery
                ? `No customers match your search query "${searchQuery}".`
                : 'Customer records will appear here as orders are placed at your restaurant.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-xs font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3.5 px-4 sm:px-6">Customer</th>
                  <th className="py-3.5 px-4">Contact Info</th>
                  <th className="py-3.5 px-4 text-center">Orders</th>
                  <th className="py-3.5 px-4 text-right">Total Spent</th>
                  <th className="py-3.5 px-4">Last Order</th>
                  <th className="py-3.5 px-4 sm:px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {customers.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    {/* Customer Info */}
                    <td className="py-4 px-4 sm:px-6">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 shadow-xs ${
                            c.isRegistered
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {c.name.charAt(0).toUpperCase() || 'C'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-900 truncate">{c.name}</span>
                            {c.isRegistered ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                <ShieldCheck className="w-3 h-3 text-indigo-600" />
                                Registered
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                Guest
                              </span>
                            )}
                          </div>
                          {c.customerId && (
                            <p className="text-xs text-slate-600 font-mono truncate max-w-[180px]">
                              UID: {c.customerId}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Contact Info */}
                    <td className="py-4 px-4">
                      <div className="space-y-0.5 text-xs">
                        {c.email ? (
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <Mail className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            <span className="truncate max-w-[180px]">{c.email}</span>
                          </div>
                        ) : null}
                        {c.phone ? (
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <Phone className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            <span>{c.phone}</span>
                          </div>
                        ) : null}
                        {!c.email && !c.phone && (
                          <span className="text-slate-600 italic">No contact info</span>
                        )}
                      </div>
                    </td>

                    {/* Orders Count */}
                    <td className="py-4 px-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-800">
                        {c.orderCount} {c.orderCount === 1 ? 'order' : 'orders'}
                      </span>
                    </td>

                    {/* Total Spend */}
                    <td className="py-4 px-4 text-right">
                      <span className="font-bold text-slate-900">
                        {formatMoney(c.totalSpendMinor, currencySymbol)}
                      </span>
                      <p className="text-[11px] text-slate-600">
                        AOV: {formatMoney(c.averageOrderValueMinor, currencySymbol)}
                      </p>
                    </td>

                    {/* Last Order */}
                    <td className="py-4 px-4">
                      <p className="text-xs font-medium text-slate-900">{formatDate(c.lastOrderDate)}</p>
                      <div className="flex items-center gap-1 text-[11px] text-slate-600 mt-0.5">
                        <span className="capitalize">{c.lastOrderType || 'Order'}</span>
                        {c.lastOrderNumber && <span>· #{c.lastOrderNumber}</span>}
                      </div>
                    </td>

                    {/* Action Button */}
                    <td className="py-4 px-4 sm:px-6 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCustomer(c);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-indigo-700 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg transition-colors shadow-xs"
                      >
                        <span>View Details</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer Detail Modal */}
      {selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          currencySymbol={currencySymbol}
          onClose={() => setSelectedCustomer(null)}
          onViewOrderInHistory={handleOpenOrder}
        />
      )}
    </div>
  );
};
