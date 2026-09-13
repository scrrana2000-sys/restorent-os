import React, { useEffect, useState, useMemo } from 'react';
import { Order } from '../../types/order';
import { Table } from '../../types/table';
import { formatMoney } from '../../utils/money';
import { getFormattedTableLabel } from '../../utils/tableLabel';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { orderService } from '../../services/orderService';
import { tableService } from '../../services/tableService';
import { printerService } from '../../services/printer/PrinterService';
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
import {
  Printer,
  X,
  Receipt,
  CheckCircle2,
  RotateCw,
  MessageSquare,
  Send,
  Copy,
  Check,
  Phone,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileText,
  Download,
  Share2
} from 'lucide-react';

interface BillReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  isReprint?: boolean;
  tableMap?: Map<string, Table>;
}

export const BillReceiptModal: React.FC<BillReceiptModalProps> = ({
  isOpen,
  onClose,
  order,
  isReprint = false,
  tableMap: tableMapProp
}) => {
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  const [printFeedback, setPrintFeedback] = React.useState<{ status: string; message: string } | null>(null);
  const [showWhatsAppSection, setShowWhatsAppSection] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const symbol = restaurant?.currencySymbol || '₹';
  const restaurantId = restaurant?.restaurantId || (restaurant as any)?.id;

  const [tables, setTables] = useState<Table[]>([]);
  useEffect(() => {
    if (!isOpen || tableMapProp || !restaurantId) return;
    const unsub = tableService.subscribeToTables(restaurantId, (liveTables) => {
      setTables(liveTables);
    });
    return () => unsub();
  }, [isOpen, tableMapProp, restaurantId]);

  const activeTableMap = useMemo(() => {
    if (tableMapProp) return tableMapProp;
    const map = new Map<string, Table>();
    tables.forEach((t) => map.set(t.id, t));
    return map;
  }, [tableMapProp, tables]);

  useEffect(() => {
    if (isOpen && order && restaurantId && user?.uid) {
      if (isReprint || order.status === 'completed') {
        orderService.logBillReprint(restaurantId, order.id, user.uid);
      } else {
        orderService.logBillViewed(restaurantId, order.id, user.uid);
      }
    }
  }, [isOpen, order?.id, restaurantId, user?.uid, isReprint]);

  useEffect(() => {
    if (!isOpen) {
      setPrintFeedback(null);
      setShowWhatsAppSection(false);
      setPhoneError(null);
      setCopied(false);
    } else if (order) {
      setWhatsappPhone(order.customerSnapshot?.phone || '');
    }
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const tableLabel = getFormattedTableLabel(order, activeTableMap);
  const billWhatsAppText = formatWhatsAppBillText(order, restaurant, { tableLabel, isReprint });

  const handleCopyWhatsAppText = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(billWhatsAppText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = billWhatsAppText;
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

  const syncCustomerPhoneInBackground = (trimmedPhone: string) => {
    if (
      restaurantId &&
      order.id &&
      trimmedPhone &&
      trimmedPhone !== (order.customerSnapshot?.phone || '')
    ) {
      orderService
        .updateCustomerSnapshot(
          restaurantId,
          order.id,
          {
            name: order.customerSnapshot?.name || 'Customer',
            phone: trimmedPhone,
            email: order.customerSnapshot?.email
          },
          user?.uid || 'staff'
        )
        .catch((e) => console.warn('Could not update customer phone in order snapshot:', e));
    }
  };

  const handleSendWhatsApp = () => {
    const trimmed = whatsappPhone.trim();
    if (!trimmed) {
      setPhoneError('Please enter a 10-digit mobile number');
      setShowWhatsAppSection(true);
      return;
    }

    const validation = formatWhatsAppPhoneNumber(trimmed, '91');
    if (!validation.valid) {
      setPhoneError(validation.error || 'Please enter a valid 10-digit mobile number');
      setShowWhatsAppSection(true);
      return;
    }

    // Run background update without blocking the user click event
    syncCustomerPhoneInBackground(trimmed);

    const url = generateWhatsAppBillUrl(trimmed, billWhatsAppText, '91');
    openWhatsAppSafely(url);
  };

  const handleDownloadPdf = () => {
    downloadBillPdf(order, restaurant, { tableLabel, isReprint });
  };

  const handleSendPdf = async () => {
    const trimmed = whatsappPhone.trim();
    syncCustomerPhoneInBackground(trimmed);

    await shareOrSendBillPdf(order, restaurant, {
      tableLabel,
      isReprint,
      phoneNumber: trimmed
    });
  };

  const handlePrint = async (reprint: boolean = false) => {
    setPrintFeedback(null);
    const restId = restaurantId;
    if (restId && user?.uid) {
      orderService.logBillReprint(restId, order.id, user.uid);
    }
    if (restId) {
      try {
        const result = await printerService.printBill(restId, order, restaurant, { isReprint: reprint });
        if (result.status === 'unknown') {
          setPrintFeedback({
            status: 'unknown',
            message: 'Print status unknown — verify printer before retrying.'
          });
        } else if (!result.success) {
          setPrintFeedback({
            status: 'failed',
            message: result.error || 'Print dispatch failed.'
          });
        } else if (result.status === 'submitted') {
          setPrintFeedback({
            status: 'submitted',
            message: 'Print job submitted to printer interface.'
          });
        }
      } catch (err: any) {
        console.warn('Hardware print dispatch failed, calling window.print() fallback:', err);
        window.print();
      }
    } else {
      window.print();
    }
  };

  const showReprintNotice = isReprint || order.status === 'completed';

  return (
    <div
      data-testid="bill-receipt-modal"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh] pb-safe animate-in slide-in-from-bottom sm:zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">
              {showReprintNotice ? 'Tax Invoice (Reprint)' : 'Tax Invoice / Receipt'}
            </h3>
          </div>
          <button
            type="button"
            data-testid="btn-close-receipt-modal"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Receipt Body */}
        <div className="p-6 overflow-y-auto font-mono text-xs text-slate-800 space-y-4 printable-receipt">
          {printFeedback && (
            <div
              data-testid="print-status-banner"
              className={`p-3 rounded-xl font-sans text-xs font-semibold flex items-center justify-between ${
                printFeedback.status === 'unknown'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : printFeedback.status === 'failed'
                  ? 'bg-rose-100 text-rose-900 border border-rose-300'
                  : 'bg-blue-100 text-blue-900 border border-blue-300'
              }`}
            >
              <span>{printFeedback.message}</span>
              <button
                type="button"
                onClick={() => setPrintFeedback(null)}
                className="text-slate-500 hover:text-slate-800 p-1"
              >
                ✕
              </button>
            </div>
          )}

          {showReprintNotice && (
            <div
              data-testid="reprint-watermark"
              className="text-center py-1 px-2 bg-slate-100 border border-slate-300 rounded text-[10px] font-extrabold text-slate-600 uppercase tracking-widest"
            >
              *** DUPLICATE / REPRINT INVOICE ***
            </div>
          )}

          {/* Restaurant Header */}
          <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
            <h2 className="text-base font-black text-slate-900 uppercase font-sans">
              {restaurant?.name || 'RestaurantOS'}
            </h2>
            {restaurant?.address && <p className="text-[11px] text-slate-600">{restaurant.address}</p>}
            {restaurant?.city && (
              <p className="text-[11px] text-slate-600">
                {restaurant.city}, {restaurant.state} {(restaurant as any).postalCode || (restaurant as any).pincode || ''}
              </p>
            )}
            {((restaurant as any).gstNumber || (restaurant as any).gstin) && (
              <p className="text-[11px] font-bold text-slate-700">GSTIN: {(restaurant as any).gstNumber || (restaurant as any).gstin}</p>
            )}
            {restaurant?.phone && <p className="text-[11px] text-slate-600">Ph: {restaurant.phone}</p>}
          </div>

          {/* Meta Information */}
          <div className="space-y-1 text-[11px] pb-3 border-b border-dashed border-slate-300">
            <div className="flex justify-between">
              <span className="font-bold">Order #:</span>
              <span data-testid="receipt-order-number" className="font-bold">{order.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Type:</span>
              <span className="capitalize font-bold">
                {order.orderType === 'takeaway' ? 'Takeaway / Parcel' : order.orderType}
              </span>
            </div>
            {order.orderType === 'dineIn' && (
              <div className="flex justify-between">
                <span>Table:</span>
                <span className="font-bold">{getFormattedTableLabel(order, activeTableMap)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Date/Time:</span>
              <span>
                {order.createdAt
                  ? new Date(
                      typeof order.createdAt.toDate === 'function'
                        ? order.createdAt.toDate()
                        : order.createdAt
                    ).toLocaleString('en-IN')
                  : new Date().toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Itemized Table */}
          <div className="space-y-2 pb-3 border-b border-dashed border-slate-300">
            <div className="flex justify-between font-bold text-slate-900 border-b border-slate-200 pb-1">
              <span className="flex-1">Item</span>
              <span className="w-10 text-center">Qty</span>
              <span className="w-16 text-right">Amount</span>
            </div>

            {order.items.map((item, idx) => (
              <div key={idx} className="flex justify-between text-[11px]" data-testid={`receipt-item-${idx}`}>
                <div className="flex-1 pr-2">
                  <p className="font-bold text-slate-900">{item.nameSnapshot}</p>
                  <p className="text-[10px] text-slate-500">
                    @{formatMoney(item.unitPriceMinor, symbol)}
                  </p>
                </div>
                <span className="w-10 text-center font-bold">{item.quantity}</span>
                <span className="w-16 text-right font-bold">
                  {formatMoney(item.lineTotalMinor, symbol)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals Breakdown */}
          <div className="space-y-1 text-[11px] pb-3 border-b border-dashed border-slate-300">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span data-testid="receipt-subtotal">{formatMoney(order.subtotalMinor, symbol)}</span>
            </div>

            {order.discountMinor > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount:</span>
                <span>-{formatMoney(order.discountMinor, symbol)}</span>
              </div>
            )}

            <div className="flex justify-between">
              <span>Taxable Amount:</span>
              <span data-testid="receipt-taxable">{formatMoney(order.taxableAmountMinor, symbol)}</span>
            </div>

            {order.cgstMinor > 0 && (
              <div className="flex justify-between">
                <span>CGST:</span>
                <span data-testid="receipt-cgst">{formatMoney(order.cgstMinor, symbol)}</span>
              </div>
            )}

            {order.sgstMinor > 0 && (
              <div className="flex justify-between">
                <span>SGST:</span>
                <span data-testid="receipt-sgst">{formatMoney(order.sgstMinor, symbol)}</span>
              </div>
            )}

            {order.igstMinor > 0 && (
              <div className="flex justify-between">
                <span>IGST:</span>
                <span data-testid="receipt-igst">{formatMoney(order.igstMinor, symbol)}</span>
              </div>
            )}

            <div className="flex justify-between font-black text-sm pt-2 text-slate-900 border-t border-slate-300">
              <span>Grand Total:</span>
              <span data-testid="receipt-grand-total">{formatMoney(order.grandTotalMinor, symbol)}</span>
            </div>
          </div>

          {/* Payment Status */}
          <div className="space-y-1 text-[11px] text-center">
            <div className="flex justify-between">
              <span>Paid Amount:</span>
              <span data-testid="receipt-paid-amount" className="font-bold text-emerald-700">
                {formatMoney(order.paidAmountMinor ?? 0, symbol)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Due Amount:</span>
              <span data-testid="receipt-due-amount" className="font-bold text-rose-600">
                {formatMoney(order.dueAmountMinor ?? 0, symbol)}
              </span>
            </div>

            {(order.dueAmountMinor ?? 0) === 0 && (
              <div className="pt-2 text-emerald-700 font-bold flex items-center justify-center gap-1 font-sans">
                <CheckCircle2 className="w-4 h-4" />
                <span>FULLY SETTLED & PAID</span>
              </div>
            )}
          </div>

          <p className="text-[10px] text-center text-slate-400 pt-2 border-t border-dashed border-slate-200">
            Thank you for dining with us!
          </p>
        </div>

        {/* WhatsApp Sharing Card (Inline Expandable) */}
        {showWhatsAppSection && (
          <div className="p-4 bg-emerald-50/70 border-t border-b border-emerald-200 no-print space-y-3 animate-in slide-in-from-bottom duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[#25D366] text-white flex items-center justify-center shadow-2xs">
                  <MessageSquare className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-bold text-emerald-950">Send Bill to WhatsApp</span>
              </div>
              <button
                type="button"
                onClick={() => setShowWhatsAppSection(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Close WhatsApp section"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-bold text-slate-500 font-mono select-none">
                  +91
                </span>
                <input
                  type="tel"
                  data-testid="input-bill-whatsapp-phone"
                  value={whatsappPhone}
                  onChange={(e) => {
                    setWhatsappPhone(e.target.value);
                    if (phoneError) setPhoneError(null);
                  }}
                  placeholder="Enter 10-digit mobile"
                  maxLength={14}
                  className={`w-full pl-11 pr-3 py-2 bg-white border rounded-xl text-xs font-bold text-slate-900 focus:outline-hidden focus:ring-2 font-mono ${
                    phoneError
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-emerald-300 focus:ring-emerald-500/20 focus:border-emerald-500'
                  }`}
                  autoFocus
                />
              </div>
              {phoneError && (
                <p className="text-[10px] text-rose-600 font-semibold flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{phoneError}</span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                data-testid="btn-copy-bill-whatsapp-text"
                onClick={handleCopyWhatsAppText}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-all flex items-center gap-1 active:scale-95 shadow-2xs"
                title="Copy formatted WhatsApp text to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700 font-bold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="btn-send-whatsapp-bill"
                  onClick={handleSendWhatsApp}
                  className="px-3 py-1.5 text-xs font-bold bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-sans rounded-xl shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95"
                  title="Send text message on WhatsApp"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Text</span>
                </button>

                <button
                  type="button"
                  data-testid="btn-send-pdf-bill"
                  onClick={handleSendPdf}
                  className="px-3.5 py-1.5 text-xs font-bold bg-[#25D366] hover:bg-[#20bd5a] text-slate-950 font-sans rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 active:scale-95"
                  title="Share or send PDF bill via WhatsApp"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Send PDF</span>
                  <Share2 className="w-3 h-3 opacity-60" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 no-print pb-safe">
          <button
            type="button"
            data-testid="btn-close-receipt"
            onClick={onClose}
            className="px-3.5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors min-h-[44px] active:scale-95"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {/* Download PDF button */}
            <button
              type="button"
              data-testid="btn-download-bill-pdf"
              onClick={handleDownloadPdf}
              className="px-3 sm:px-3.5 py-2.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl transition-all flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95"
              title="Download Tax Invoice as PDF"
            >
              <Download className="w-4 h-4 text-red-600" />
              <span>PDF</span>
            </button>

            {/* WhatsApp button */}
            <button
              type="button"
              data-testid="btn-open-whatsapp-bill"
              onClick={() => {
                if (!showWhatsAppSection && (!whatsappPhone || whatsappPhone.trim().length === 0)) {
                  setShowWhatsAppSection(true);
                } else if (showWhatsAppSection && whatsappPhone.trim().length >= 10) {
                  handleSendPdf();
                } else {
                  setShowWhatsAppSection(!showWhatsAppSection);
                }
              }}
              className="px-3.5 sm:px-4 py-2.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95"
              title="Send bill to customer WhatsApp"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden xs:inline">WhatsApp</span>
              <span className="xs:hidden">WA</span>
            </button>

            {showReprintNotice ? (
              <button
                type="button"
                data-testid="btn-reprint-bill"
                onClick={() => handlePrint(true)}
                className="px-4 sm:px-5 py-2.5 text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95"
              >
                <RotateCw className="w-4 h-4" />
                <span>Reprint</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="btn-print-bill"
                onClick={() => handlePrint(false)}
                className="px-4 sm:px-5 py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95"
              >
                <Printer className="w-4 h-4" />
                <span>Print Bill</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
