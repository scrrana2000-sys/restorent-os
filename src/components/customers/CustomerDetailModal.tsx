import React from 'react';
import {
  X,
  User,
  ShieldCheck,
  UserCheck,
  ShoppingBag,
  Calendar,
  Phone,
  Mail,
  MapPin,
  Clock,
  ExternalLink,
  Receipt,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { RestaurantCustomer } from '../../types/restaurantCustomer';
import { Order, OrderStatus } from '../../types/order';
import { formatMoney } from '../../utils/money';

interface CustomerDetailModalProps {
  customer: RestaurantCustomer | null;
  currencySymbol: string;
  onClose: () => void;
  onViewOrderInHistory?: (orderId: string) => void;
}

export const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  customer,
  currencySymbol,
  onClose,
  onViewOrderInHistory
}) => {
  if (!customer) return null;

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'completed':
      case 'served':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" />
            Completed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3" />
            Cancelled
          </span>
        );
      case 'preparing':
      case 'sentToKitchen':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3" />
            In Kitchen
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
            <CheckCircle2 className="w-3 h-3" />
            Ready
          </span>
        );
      case 'confirmed':
      case 'draft':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            <Clock className="w-3 h-3" />
            {status}
          </span>
        );
    }
  };

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

  return (
    <div
      id="customer-detail-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="customer-detail-modal-content"
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-lg shadow-xs ${
                customer.isRegistered
                  ? 'bg-indigo-600 text-white shadow-indigo-200'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {customer.name.charAt(0).toUpperCase() || 'C'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">{customer.name}</h2>
                {customer.isRegistered ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                    Registered Account
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    Guest Activity
                  </span>
                )}
              </div>
              {customer.customerId && (
                <p className="text-xs text-slate-600 font-mono mt-0.5">UID: {customer.customerId}</p>
              )}
            </div>
          </div>
          <button
            id="close-customer-modal-btn"
            type="button"
            onClick={onClose}
            className="p-2 text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Contact Details & Meta */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm">
            <div className="flex items-start gap-2.5">
              <Mail className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Email</p>
                <p className="text-slate-900 font-medium break-all">
                  {customer.email || 'Not provided'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Phone className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Phone</p>
                <p className="text-slate-900 font-medium">{customer.phone || 'Not provided'}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Last Address</p>
                <p className="text-slate-900 font-medium line-clamp-2">
                  {customer.address || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Operational Metrics Cards */}
          <div>
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
              Restaurant Activity Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <p className="text-xs text-slate-600 font-medium">Total Orders</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{customer.orderCount}</p>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-1">
                  <span className="text-emerald-700 font-semibold">{customer.completedOrderCount} done</span>
                  {customer.cancelledOrderCount > 0 && (
                    <span className="text-rose-700 font-semibold">· {customer.cancelledOrderCount} canc</span>
                  )}
                </div>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <p className="text-xs text-slate-600 font-medium">Total Spent</p>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {formatMoney(customer.totalSpendMinor, currencySymbol)}
                </p>
                <p className="text-xs text-slate-600 mt-1">Valid orders sum</p>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <p className="text-xs text-slate-600 font-medium">Average Order</p>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {formatMoney(customer.averageOrderValueMinor, currencySymbol)}
                </p>
                <p className="text-xs text-slate-600 mt-1">Per transaction</p>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <p className="text-xs text-slate-600 font-medium">Last Ordered</p>
                <p className="text-sm font-bold text-slate-900 mt-1 truncate">
                  {formatDate(customer.lastOrderDate)}
                </p>
                <p className="text-xs text-slate-600 mt-1 capitalize">
                  {customer.lastOrderType || 'Online'}
                </p>
              </div>
            </div>
          </div>

          {/* Restaurant Order History */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Order History at this Restaurant ({customer.recentOrders.length})
              </h3>
            </div>

            {customer.recentOrders.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-200">
                <ShoppingBag className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600">No order records found for this customer.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {customer.recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-200 transition-colors shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-sm text-slate-900">
                          #{order.orderNumber || order.id.slice(-6)}
                        </span>
                        {getStatusBadge(order.status)}
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-xs font-medium capitalize">
                          {order.orderType}
                        </span>
                        <span className="text-xs text-slate-600 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(order.createdAt)}
                        </span>
                      </div>

                      {/* Items list preview */}
                      <div className="text-xs text-slate-600">
                        {order.items && order.items.length > 0 ? (
                          <span>
                            {order.items
                              .slice(0, 3)
                              .map((i) => `${i.quantity}x ${i.nameSnapshot}`)
                              .join(', ')}
                            {order.items.length > 3 && ` +${order.items.length - 3} more`}
                          </span>
                        ) : (
                          <span>{order.itemCount || 1} item(s)</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                      <div className="text-right">
                        <p className="text-xs text-slate-600">Total</p>
                        <p className="text-base font-bold text-slate-900">
                          {formatMoney(order.grandTotalMinor || 0, currencySymbol)}
                        </p>
                      </div>

                      {onViewOrderInHistory && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onViewOrderInHistory(order.id);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                          View Order
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <p>Tenant-scoped CRM data • Restaurant-specific order records only</p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-xl border border-slate-200 transition-colors shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
