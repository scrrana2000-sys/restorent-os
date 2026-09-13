import React, { useEffect, useState } from 'react';
import { Order } from '../types/order';
import { Restaurant } from '../types/restaurant';
import { orderService } from '../services/orderService';
import { getRestaurantById } from '../services/restaurantService';
import { formatMoney } from '../utils/money';
import { downloadBillPdf } from '../utils/pdfBillGenerator';
import { extractBillParamsFromUrl } from '../utils/urlUtils';
import {
  Download,
  Printer,
  FileText,
  CheckCircle2,
  Receipt,
  UtensilsCrossed,
  Phone,
  MapPin,
  Clock,
  AlertCircle,
  Loader2,
  Sparkles
} from 'lucide-react';

export const PublicBillPage: React.FC = () => {
  const [order, setOrder] = useState<Order | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const params = extractBillParamsFromUrl();
    if (!params || !params.orderId) {
      setError('Invalid or missing invoice link. Please check the URL.');
      setLoading(false);
      return;
    }

    async function loadBillData() {
      try {
        setLoading(true);
        const { orderId, restaurantId, autoDownload } = params!;

        let loadedOrder: Order | null = null;
        let loadedRestaurant: Restaurant | null = null;

        // If restaurantId is known
        if (restaurantId) {
          loadedRestaurant = await getRestaurantById(restaurantId);
          loadedOrder = await orderService.getOrderById(restaurantId, orderId);
        }

        if (!loadedOrder) {
          setError(`Invoice #${orderId} could not be located. It may have been archived or removed.`);
          setLoading(false);
          return;
        }

        setOrder(loadedOrder);
        setRestaurant(loadedRestaurant);

        // Auto-download if specified in query param
        if (autoDownload) {
          setTimeout(() => {
            downloadBillPdf(loadedOrder!, loadedRestaurant, {
              isReprint: loadedOrder!.status === 'completed'
            });
            setDownloaded(true);
          }, 400);
        }
      } catch (err: any) {
        console.error('Error fetching public bill:', err);
        setError('Unable to load tax invoice at this time. Please try again later.');
      } finally {
        setLoading(false);
      }
    }

    loadBillData();
  }, []);

  const handleDownloadPdf = () => {
    if (!order) return;
    downloadBillPdf(order, restaurant, {
      isReprint: order.status === 'completed'
    });
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mb-4">
          <Loader2 className="w-7 h-7 text-indigo-400 animate-spin" />
        </div>
        <h2 className="text-base font-bold">Loading Tax Invoice...</h2>
        <p className="text-xs text-slate-400 mt-1">Generating official digital bill</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center mb-4">
          <AlertCircle className="w-7 h-7 text-rose-400" />
        </div>
        <h2 className="text-base font-bold">Invoice Not Found</h2>
        <p className="text-xs text-slate-400 mt-1 text-center max-w-sm">{error}</p>
      </div>
    );
  }

  const symbol = restaurant?.currencySymbol || '₹';
  const restaurantName = restaurant?.name || 'Restaurant';
  const gstin = (restaurant as any)?.gstNumber || (restaurant as any)?.gstin;
  const isPaid = (order.dueAmountMinor ?? 0) === 0;

  const dateFormatted = order.createdAt
    ? new Date(
        typeof (order.createdAt as any).toDate === 'function'
          ? (order.createdAt as any).toDate()
          : order.createdAt
      ).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    : new Date().toLocaleDateString('en-IN');

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 py-6 px-3 sm:px-6 flex flex-col items-center justify-start antialiased">
      <div className="w-full max-w-md space-y-4">
        {/* Top Header Card */}
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-3xl p-4 sm:p-5 backdrop-blur-md shadow-xl flex items-center justify-between no-print">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 block">
                Digital Invoice
              </span>
              <h1 className="text-sm font-black text-white font-mono">{order.orderNumber}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="btn-print-public-bill"
              onClick={handlePrint}
              className="p-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
              title="Print Bill"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              data-testid="btn-download-public-pdf"
              onClick={handleDownloadPdf}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 active:scale-95"
            >
              {downloaded ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              <span>{downloaded ? 'Downloaded' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

        {/* Paper Invoice Box (White, High-Contrast) */}
        <div
          id="public-printable-invoice"
          className="bg-white text-slate-900 rounded-3xl shadow-2xl p-5 sm:p-6 border border-slate-200 space-y-4 print:p-0 print:shadow-none print:border-none"
        >
          {/* Header */}
          <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
            <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
              Tax Invoice / Bill
            </span>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
              {restaurantName}
            </h2>
            {restaurant?.address && (
              <p className="text-xs text-slate-600 flex items-center justify-center gap-1">
                <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                <span>{restaurant.address}</span>
              </p>
            )}
            {gstin && (
              <p className="text-xs font-mono font-bold text-slate-700">
                GSTIN: {gstin}
              </p>
            )}
            {restaurant?.phone && (
              <p className="text-xs text-slate-600 flex items-center justify-center gap-1">
                <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                <span>{restaurant.phone}</span>
              </p>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs py-1 border-b border-dashed border-slate-300">
            <div>
              <span className="text-[10px] text-slate-500 block">Order Number</span>
              <span className="font-mono font-bold text-slate-900">{order.orderNumber}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block">Date & Time</span>
              <span className="text-slate-800">{dateFormatted}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">Order Type</span>
              <span className="font-semibold text-slate-800 capitalize">
                {order.orderType === 'dineIn' ? 'Dine-In' : order.orderType}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block">Recipient</span>
              <span className="font-semibold text-slate-800">
                {order.customerSnapshot?.name || 'Walk-in Guest'}
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase border-b border-slate-200 pb-1">
              <span>Item Description</span>
              <span>Amount</span>
            </div>

            <div className="space-y-1.5 divide-y divide-slate-100 text-xs">
              {order.items.map((item, idx) => (
                <div key={idx} className="pt-1.5 flex items-start justify-between">
                  <div className="pr-2">
                    <span className="font-bold text-slate-900 block leading-tight">
                      {item.nameSnapshot}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {item.quantity} x {formatMoney(item.unitPriceMinor, symbol)}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-slate-900 shrink-0">
                    {formatMoney(item.lineTotalMinor, symbol)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Totals Breakdown */}
          <div className="border-t border-dashed border-slate-300 pt-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-mono">{formatMoney(order.subtotalMinor, symbol)}</span>
            </div>

            {order.discountMinor > 0 && (
              <div className="flex justify-between text-rose-600 font-semibold">
                <span>Discount</span>
                <span className="font-mono">-{formatMoney(order.discountMinor, symbol)}</span>
              </div>
            )}

            {order.taxableAmountMinor && order.taxableAmountMinor > 0 ? (
              <div className="flex justify-between text-slate-500 text-[11px]">
                <span>Taxable Amount</span>
                <span className="font-mono">{formatMoney(order.taxableAmountMinor, symbol)}</span>
              </div>
            ) : null}

            {order.cgstMinor > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>CGST</span>
                <span className="font-mono">{formatMoney(order.cgstMinor, symbol)}</span>
              </div>
            )}

            {order.sgstMinor > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>SGST</span>
                <span className="font-mono">{formatMoney(order.sgstMinor, symbol)}</span>
              </div>
            )}

            <div className="flex justify-between text-base font-black text-slate-900 pt-2 border-t border-slate-300">
              <span>Grand Total</span>
              <span className="font-mono">{formatMoney(order.grandTotalMinor, symbol)}</span>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">Payment Status:</span>
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
                  isPaid
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isPaid ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>PAID IN FULL</span>
                  </>
                ) : (
                  <span>DUE: {formatMoney(order.dueAmountMinor ?? 0, symbol)}</span>
                )}
              </span>
            </div>
          </div>

          {/* Footer Note */}
          <div className="text-center pt-3 border-t border-dashed border-slate-300">
            <p className="text-xs font-medium text-slate-600">
              Thank you for dining with us! Please visit again.
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
              RestaurantOS Digital Tax Invoice
            </p>
          </div>
        </div>

        {/* Action Button at bottom */}
        <div className="no-print pt-2">
          <button
            type="button"
            data-testid="btn-download-public-pdf-bottom"
            onClick={handleDownloadPdf}
            className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition-all active:scale-98"
          >
            <FileText className="w-4 h-4" />
            <span>Download Official PDF Tax Invoice</span>
            <Download className="w-4 h-4 opacity-80" />
          </button>
        </div>
      </div>
    </div>
  );
};
