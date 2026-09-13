import React, { useState, useEffect } from 'react';
import { Order } from '../../types/order';
import { Table } from '../../types/table';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { getFormattedTableLabel } from '../../utils/tableLabel';
import {
  formatWhatsAppBillText,
  formatWhatsAppPhoneNumber,
  generateWhatsAppBillUrl,
  openWhatsAppSafely
} from '../../utils/whatsappBillFormatter';
import {
  downloadBillPdf,
  shareOrSendBillPdf
} from '../../utils/pdfBillGenerator';
import { orderService } from '../../services/orderService';
import {
  X,
  Send,
  Copy,
  Check,
  Phone,
  MessageSquare,
  ExternalLink,
  Receipt,
  AlertCircle,
  FileText,
  Download,
  Share2,
  CheckCircle2
} from 'lucide-react';

export interface WhatsAppBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  tableMap?: Map<string, Table>;
  isReprint?: boolean;
}

export const WhatsAppBillModal: React.FC<WhatsAppBillModalProps> = ({
  isOpen,
  onClose,
  order,
  tableMap,
  isReprint = false
}) => {
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  const restaurantId = restaurant?.restaurantId || (restaurant as any)?.id;

  const [phoneNumber, setPhoneNumber] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (isOpen && order) {
      const existingPhone = order.customerSnapshot?.phone || '';
      setPhoneNumber(existingPhone);
      setPhoneError(null);
      setCopied(false);
      setDownloaded(false);
      setSentNotice(null);
      setShowPreview(false);
    }
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const tableLabel = getFormattedTableLabel(order, tableMap);
  const billText = formatWhatsAppBillText(order, restaurant, { tableLabel, isReprint });
  const activeWhatsAppUrl = generateWhatsAppBillUrl(phoneNumber.trim(), billText, '91');

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPhoneNumber(val);
    if (phoneError) setPhoneError(null);
  };

  const handleCopyText = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(billText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = billText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy bill text:', err);
    }
  };

  const syncCustomerPhoneInBackground = (phoneVal: string) => {
    if (
      restaurantId &&
      order.id &&
      phoneVal &&
      phoneVal !== (order.customerSnapshot?.phone || '')
    ) {
      orderService
        .updateCustomerSnapshot(
          restaurantId,
          order.id,
          {
            name: order.customerSnapshot?.name || 'Customer',
            phone: phoneVal,
            email: order.customerSnapshot?.email
          },
          user?.uid || 'staff'
        )
        .catch((e) => console.warn('Could not update customer phone in order snapshot:', e));
    }
  };

  const handleDownloadPdf = () => {
    downloadBillPdf(order, restaurant, { tableLabel, isReprint });
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  const handleSendPdfBill = async () => {
    const phoneVal = phoneNumber.trim();
    if (phoneVal) {
      const validation = formatWhatsAppPhoneNumber(phoneVal, '91');
      if (!validation.valid) {
        setPhoneError(validation.error || 'Please enter a valid 10-digit phone number');
        return;
      }
    }

    try {
      setIsProcessing(true);
      // Run background snapshot update asynchronously without blocking user gesture
      syncCustomerPhoneInBackground(phoneVal);

      // Perform synchronous share/download and safe WhatsApp navigation
      await shareOrSendBillPdf(order, restaurant, {
        tableLabel,
        isReprint,
        phoneNumber: phoneVal
      });

      setDownloaded(true);
      setSentNotice('PDF Downloaded & WhatsApp chat opened with customer link!');
    } catch (err) {
      console.error('Failed to share/send PDF bill:', err);
      // Fallback: download directly and open WhatsApp URL
      downloadBillPdf(order, restaurant, { tableLabel, isReprint });
      openWhatsAppSafely(activeWhatsAppUrl);
      setSentNotice('PDF Downloaded & WhatsApp opened!');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendWhatsAppText = () => {
    const phoneVal = phoneNumber.trim();
    if (!phoneVal) {
      setPhoneError('Please enter a 10-digit mobile number');
      return;
    }

    const validation = formatWhatsAppPhoneNumber(phoneVal, '91');
    if (!validation.valid) {
      setPhoneError(validation.error || 'Please enter a valid 10-digit phone number');
      return;
    }

    try {
      setIsProcessing(true);
      syncCustomerPhoneInBackground(phoneVal);
      const url = generateWhatsAppBillUrl(phoneVal, billText, '91');
      openWhatsAppSafely(url);
      setSentNotice('WhatsApp chat opened with bill text!');
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      data-testid="whatsapp-bill-modal"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh] pb-safe animate-in slide-in-from-bottom sm:zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 bg-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center shadow-xs">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>WhatsApp & PDF Bill</span>
                <span className="text-[10px] bg-emerald-800 text-emerald-200 px-1.5 py-0.5 rounded font-mono">
                  {order.orderNumber}
                </span>
              </h3>
              <p className="text-[11px] text-emerald-100">
                Send PDF bill or message directly to customer mobile
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="btn-close-whatsapp-modal"
            onClick={onClose}
            className="p-1.5 text-emerald-200 hover:text-white hover:bg-emerald-600/50 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Mobile Number Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                <span>Customer WhatsApp Mobile Number</span>
              </span>
              <span className="text-[10px] font-normal text-slate-400">10-Digit Mobile</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-sm font-bold text-slate-500 font-mono select-none">
                +91
              </span>
              <input
                type="tel"
                data-testid="input-whatsapp-phone"
                value={phoneNumber}
                onChange={handlePhoneChange}
                placeholder="e.g. 9876543210"
                maxLength={14}
                className={`w-full pl-13 pr-4 py-2.5 bg-slate-50 border rounded-xl text-sm font-bold text-slate-900 focus:outline-hidden focus:ring-2 transition-all font-mono ${
                  phoneError
                    ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/40'
                    : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white'
                }`}
                autoFocus
              />
            </div>
            {phoneError && (
              <p className="text-[11px] text-rose-600 font-semibold flex items-center gap-1 pt-0.5">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{phoneError}</span>
              </p>
            )}
          </div>

          {/* Customer Summary Card */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
            <div>
              <p className="text-slate-500 text-[11px]">Bill Recipient</p>
              <p className="font-bold text-slate-800">
                {order.customerSnapshot?.name || 'Walk-in Guest'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-slate-500 text-[11px]">Grand Total</p>
              <p className="font-black text-slate-900 font-mono text-sm">
                {restaurant?.currencySymbol || '₹'}{(order.grandTotalMinor / 100).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Quick PDF & Text Actions Card */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="btn-modal-download-pdf"
              onClick={handleDownloadPdf}
              className="p-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all flex items-center gap-2.5 text-left active:scale-95 group"
            >
              <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                {downloaded ? <Check className="w-4 h-4 text-emerald-600" /> : <Download className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">
                  {downloaded ? 'Downloaded!' : 'Download PDF'}
                </p>
                <p className="text-[10px] text-slate-500">GST Invoice PDF</p>
              </div>
            </button>

            <button
              type="button"
              data-testid="btn-copy-whatsapp-text"
              onClick={handleCopyText}
              className="p-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all flex items-center gap-2.5 text-left active:scale-95 group"
            >
              <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">
                  {copied ? 'Copied!' : 'Copy Text'}
                </p>
                <p className="text-[10px] text-slate-500">WhatsApp text format</p>
              </div>
            </button>
          </div>

          {/* Sent Notice & Direct Link Fallback */}
          {sentNotice && (
            <div className="p-3 bg-emerald-100/90 border border-emerald-300 rounded-2xl flex flex-col gap-1.5 animate-fadeIn text-emerald-950">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{sentNotice}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-emerald-200/80 text-[11px]">
                <span className="text-emerald-800">If WhatsApp didn't open:</span>
                <a
                  href={activeWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-direct-open-whatsapp"
                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold inline-flex items-center gap-1 shadow-xs"
                >
                  <span>Open WhatsApp</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {/* PDF Delivery Notice */}
          <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl text-[11px] text-emerald-950 flex items-start gap-2">
            <FileText className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-emerald-900">Official PDF Bill Delivery</p>
              <p className="text-emerald-800 leading-normal">
                Clicking <strong>Send PDF Bill</strong> downloads the PDF invoice and opens WhatsApp with the customer's direct PDF download link.
              </p>
            </div>
          </div>

          {/* Preview Toggle */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <button
              type="button"
              data-testid="btn-toggle-whatsapp-preview"
              onClick={() => setShowPreview(!showPreview)}
              className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-bold text-slate-700 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-slate-500" />
                <span>{showPreview ? 'Hide Text Preview' : 'View Message Preview'}</span>
              </span>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                {order.items.length} items
              </span>
            </button>

            {showPreview && (
              <div className="p-3.5 bg-slate-900 text-emerald-300 font-mono text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed border-t border-slate-800">
                {billText}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 no-print pb-safe">
          <button
            type="button"
            data-testid="btn-cancel-whatsapp"
            onClick={onClose}
            className="px-3.5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors min-h-[44px] active:scale-95"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="btn-send-whatsapp-text"
              onClick={handleSendWhatsAppText}
              disabled={isProcessing}
              className="px-3.5 py-2.5 text-xs font-bold bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-xl transition-all flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95 shadow-2xs"
              title="Open WhatsApp with formatted message"
            >
              <MessageSquare className="w-4 h-4 text-emerald-600" />
              <span>Send Text</span>
            </button>

            <button
              type="button"
              data-testid="btn-send-pdf-bill"
              onClick={handleSendPdfBill}
              disabled={isProcessing}
              className="px-4.5 py-2.5 text-xs font-bold bg-[#25D366] hover:bg-[#20bd5a] text-slate-950 rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95 font-sans"
              title="Share or send PDF bill directly"
            >
              <FileText className="w-4 h-4" />
              <span>Send PDF Bill</span>
              <Share2 className="w-3.5 h-3.5 opacity-70" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
