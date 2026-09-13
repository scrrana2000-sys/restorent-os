import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Order } from '../types/order';
import { Restaurant } from '../types/restaurant';
import { formatMoney } from './money';
import {
  formatWhatsAppPhoneNumber,
  generateWhatsAppBillUrl,
  formatWhatsAppBillText,
  openWhatsAppSafely
} from './whatsappBillFormatter';

export interface PdfBillOptions {
  tableLabel?: string;
  isReprint?: boolean;
}

/**
 * Creates a formatted jsPDF document instance representing the GST Tax Invoice / Bill.
 */
export function generateBillPdfDocument(
  order: Order,
  restaurant: Partial<Restaurant> | null,
  options: PdfBillOptions = {}
): jsPDF {
  // Page width 80mm (receipt style) or 105mm (A6) or A5. 80mm width with dynamic height is the industry standard for restaurant bills.
  // We use standard 80mm receipt width with high-DPI rendering.
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 240] // 80mm thermal roll format, expandable
  });

  const symbol = restaurant?.currencySymbol || '₹';
  const restaurantName = (restaurant?.name || 'RestaurantOS').toUpperCase();
  const showReprint = options.isReprint || order.status === 'completed';

  let y = 8;
  const pageWidth = 80;
  const margin = 5;
  const contentWidth = pageWidth - margin * 2;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TAX INVOICE / BILL', pageWidth / 2, y, { align: 'center' });
  y += 4.5;

  if (showReprint) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text('(Duplicate / Reprint Bill)', pageWidth / 2, y, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    y += 3.5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(restaurantName, pageWidth / 2, y, { align: 'center' });
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  if (restaurant?.address) {
    const splitAddress = doc.splitTextToSize(restaurant.address, contentWidth);
    doc.text(splitAddress, pageWidth / 2, y, { align: 'center' });
    y += splitAddress.length * 3;
  }

  const cityLine = [restaurant?.city, restaurant?.state].filter(Boolean).join(', ');
  if (cityLine) {
    doc.text(cityLine, pageWidth / 2, y, { align: 'center' });
    y += 3;
  }

  const gstin = (restaurant as any)?.gstNumber || (restaurant as any)?.gstin;
  if (gstin) {
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${gstin}`, pageWidth / 2, y, { align: 'center' });
    y += 3;
  }

  if (restaurant?.phone) {
    doc.setFont('helvetica', 'normal');
    doc.text(`Ph: ${restaurant.phone}`, pageWidth / 2, y, { align: 'center' });
    y += 3.5;
  }

  // Divider Line
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += 3;

  // Order Details (Key-Value Grid)
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(`Order #: ${order.orderNumber}`, margin, y);

  const orderTypeStr = order.orderType === 'takeaway' ? 'Takeaway' : order.orderType === 'dineIn' ? 'Dine-In' : order.orderType;
  doc.setFont('helvetica', 'normal');
  doc.text(`Type: ${orderTypeStr}`, pageWidth - margin, y, { align: 'right' });
  y += 3;

  if (options.tableLabel) {
    doc.setFont('helvetica', 'bold');
    doc.text(`Table: ${options.tableLabel}`, margin, y);
  } else if (order.tableId) {
    doc.setFont('helvetica', 'bold');
    doc.text(`Table: ${order.tableId}`, margin, y);
  }

  const dateStr = order.createdAt
    ? new Date(
        typeof (order.createdAt as any).toDate === 'function'
          ? (order.createdAt as any).toDate()
          : order.createdAt
      ).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    : new Date().toLocaleDateString('en-IN');

  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, pageWidth - margin, y, { align: 'right' });
  y += 3;

  if (order.customerSnapshot?.name || order.customerSnapshot?.phone) {
    const custName = order.customerSnapshot.name || 'Guest';
    const custPhone = order.customerSnapshot.phone ? ` (${order.customerSnapshot.phone})` : '';
    doc.text(`Cust: ${custName}${custPhone}`, margin, y);
    y += 3;
  }

  // Items Table
  const tableData = order.items.map((item) => [
    item.nameSnapshot,
    String(item.quantity),
    (item.unitPriceMinor / 100).toFixed(2),
    (item.lineTotalMinor / 100).toFixed(2)
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Item', 'Qty', 'Rate', 'Amount']],
    body: tableData,
    theme: 'plain',
    styles: {
      fontSize: 6.5,
      cellPadding: 1,
      overflow: 'linebreak',
      textColor: [0, 0, 0]
    },
    headStyles: {
      fontStyle: 'bold',
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [200, 200, 200]
    },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 8, halign: 'center' },
      2: { cellWidth: 14, halign: 'right' },
      3: { cellWidth: 14, halign: 'right', fontStyle: 'bold' }
    }
  });

  const finalY = (doc as any).lastAutoTable?.finalY || y + 20;
  y = finalY + 2;

  // Financial Breakdown
  doc.line(margin, y, pageWidth - margin, y);
  y += 3;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');

  const addSummaryRow = (label: string, value: string, isBold: boolean = false) => {
    if (isBold) {
      doc.setFont('helvetica', 'bold');
    } else {
      doc.setFont('helvetica', 'normal');
    }
    doc.text(label, margin, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += 3;
  };

  addSummaryRow('Subtotal:', formatMoney(order.subtotalMinor, symbol));

  if (order.discountMinor > 0) {
    addSummaryRow('Discount:', `-${formatMoney(order.discountMinor, symbol)}`);
  }

  if (order.taxableAmountMinor && order.taxableAmountMinor > 0) {
    addSummaryRow('Taxable Value:', formatMoney(order.taxableAmountMinor, symbol));
  }

  if (order.cgstMinor > 0) {
    addSummaryRow('CGST:', formatMoney(order.cgstMinor, symbol));
  }
  if (order.sgstMinor > 0) {
    addSummaryRow('SGST:', formatMoney(order.sgstMinor, symbol));
  }
  if (order.igstMinor > 0) {
    addSummaryRow('IGST:', formatMoney(order.igstMinor, symbol));
  }

  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 3.5;

  // Grand Total Highlight
  doc.setFontSize(8.5);
  addSummaryRow('Grand Total:', formatMoney(order.grandTotalMinor, symbol), true);

  doc.setFontSize(7);
  const paidMinor = order.paidAmountMinor ?? 0;
  const dueMinor = order.dueAmountMinor ?? 0;

  addSummaryRow('Paid Amount:', formatMoney(paidMinor, symbol));
  if (dueMinor > 0) {
    addSummaryRow('Due Amount:', formatMoney(dueMinor, symbol), true);
  }

  // Payment Status Badge
  y += 1;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  if (dueMinor === 0) {
    doc.setTextColor(16, 120, 60);
    doc.text('PAYMENT STATUS: FULLY PAID', pageWidth / 2, y, { align: 'center' });
  } else {
    doc.setTextColor(200, 40, 40);
    doc.text(`PAYMENT STATUS: DUE ${formatMoney(dueMinor, symbol)}`, pageWidth / 2, y, { align: 'center' });
  }
  doc.setTextColor(0, 0, 0);
  y += 4;

  // Footer Message
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 3.5;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text('Thank you for dining with us! Please visit again.', pageWidth / 2, y, { align: 'center' });

  return doc;
}

/**
 * Downloads the generated PDF bill to the client's device.
 */
export function downloadBillPdf(
  order: Order,
  restaurant: Partial<Restaurant> | null,
  options: PdfBillOptions = {}
): void {
  const doc = generateBillPdfDocument(order, restaurant, options);
  const fileName = `Bill_${order.orderNumber || order.id}.pdf`;
  doc.save(fileName);
}

/**
 * Generates a File object representing the PDF bill.
 */
export function generateBillPdfFile(
  order: Order,
  restaurant: Partial<Restaurant> | null,
  options: PdfBillOptions = {}
): File {
  const doc = generateBillPdfDocument(order, restaurant, options);
  const pdfBlob = doc.output('blob');
  const fileName = `Bill_${order.orderNumber || order.id}.pdf`;
  return new File([pdfBlob], fileName, { type: 'application/pdf' });
}

export interface SharePdfResult {
  shared: boolean;
  downloaded: boolean;
  method: 'native-share' | 'whatsapp-link';
}

/**
 * Shares or sends the PDF bill:
 * 1. Uses navigator.share with the PDF file on supported mobile/desktop devices (direct WhatsApp file attachment).
 * 2. Fallbacks gracefully to downloading the PDF file and opening WhatsApp with the pre-filled bill message.
 */
export async function shareOrSendBillPdf(
  order: Order,
  restaurant: Partial<Restaurant> | null,
  options: PdfBillOptions & { phoneNumber?: string } = {}
): Promise<SharePdfResult> {
  const pdfFile = generateBillPdfFile(order, restaurant, options);
  const textMessage = formatWhatsAppBillText(order, restaurant, options);

  // Check if navigator.canShare supports files (e.g. mobile Chrome, Safari, Edge)
  if (
    typeof navigator !== 'undefined' &&
    navigator.canShare &&
    navigator.canShare({ files: [pdfFile] }) &&
    typeof navigator.share === 'function'
  ) {
    try {
      await navigator.share({
        title: `Bill ${order.orderNumber} - ${restaurant?.name || 'RestaurantOS'}`,
        text: `Here is your Bill Receipt (Tax Invoice) #${order.orderNumber} from ${restaurant?.name || 'RestaurantOS'}.`,
        files: [pdfFile]
      });
      return { shared: true, downloaded: false, method: 'native-share' };
    } catch (err: any) {
      // If user aborted or canceled share, do not trigger fallback error
      if (err?.name === 'AbortError') {
        return { shared: false, downloaded: false, method: 'native-share' };
      }
      console.warn('Native share failed, using WhatsApp URL fallback:', err);
    }
  }

  // Fallback: Download PDF to device & open WhatsApp safely
  downloadBillPdf(order, restaurant, options);

  const phone = options.phoneNumber?.trim() || order.customerSnapshot?.phone || '';
  const url = generateWhatsAppBillUrl(phone, textMessage, '91');
  openWhatsAppSafely(url);

  return { shared: true, downloaded: true, method: 'whatsapp-link' };
}
