import { Order } from '../types/order';
import { Restaurant } from '../types/restaurant';
import { formatMoney } from './money';
import { buildPublicBillUrl } from './urlUtils';

export interface WhatsAppPhoneResult {
  valid: boolean;
  cleanDigits: string;
  formattedInternational: string;
  error?: string;
}

/**
 * Validates and formats a phone number for WhatsApp Web/App wa.me linking.
 * Defaults to Indian country code '91' if 10-digit mobile is provided.
 */
export function formatWhatsAppPhoneNumber(
  phone: string,
  defaultCountryCode: string = '91'
): WhatsAppPhoneResult {
  if (!phone || typeof phone !== 'string') {
    return {
      valid: false,
      cleanDigits: '',
      formattedInternational: '',
      error: 'Phone number is required'
    };
  }

  // Remove all non-numeric characters except leading plus if any
  const rawClean = phone.replace(/[^0-9]/g, '');

  if (!rawClean) {
    return {
      valid: false,
      cleanDigits: '',
      formattedInternational: '',
      error: 'Invalid phone number'
    };
  }

  let finalNumber = rawClean;

  // Handle leading 0 (e.g. 09876543210 -> 919876543210)
  if (finalNumber.length === 11 && finalNumber.startsWith('0')) {
    finalNumber = defaultCountryCode + finalNumber.substring(1);
  } else if (finalNumber.length === 10) {
    // Standard 10-digit Indian number
    finalNumber = defaultCountryCode + finalNumber;
  }

  // International standard: E.164 without plus sign, usually 10 to 15 digits
  if (finalNumber.length < 10 || finalNumber.length > 15) {
    return {
      valid: false,
      cleanDigits: rawClean,
      formattedInternational: finalNumber,
      error: 'Please enter a valid 10-digit mobile number'
    };
  }

  return {
    valid: true,
    cleanDigits: rawClean,
    formattedInternational: finalNumber
  };
}

export interface WhatsAppBillOptions {
  tableLabel?: string;
  isReprint?: boolean;
}

/**
 * Formats a clean, professional WhatsApp text invoice with markdown styling.
 */
export function formatWhatsAppBillText(
  order: Order,
  restaurant: Partial<Restaurant> | null,
  options: WhatsAppBillOptions = {}
): string {
  const symbol = restaurant?.currencySymbol || '₹';
  const restaurantName = (restaurant?.name || 'RestaurantOS').toUpperCase();
  const showReprint = options.isReprint || order.status === 'completed';

  const lines: string[] = [];

  // Header
  lines.push(`🧾 *TAX INVOICE / BILL RECEIPT*`);
  if (showReprint) {
    lines.push(`_(Duplicate / Reprint Invoice)_`);
  }
  lines.push(`*${restaurantName}*`);

  if (restaurant?.address) {
    lines.push(`📍 ${restaurant.address}`);
  }
  if (restaurant?.city) {
    const loc = `${restaurant.city}${restaurant.state ? ', ' + restaurant.state : ''} ${(restaurant as any).postalCode || (restaurant as any).pincode || ''}`.trim();
    if (loc) lines.push(`🏙️ ${loc}`);
  }
  const gst = (restaurant as any)?.gstNumber || (restaurant as any)?.gstin;
  if (gst) {
    lines.push(`🏢 *GSTIN:* ${gst}`);
  }
  if (restaurant?.phone) {
    lines.push(`📞 *Ph:* ${restaurant.phone}`);
  }

  lines.push('────────────────────────');

  // Order Details
  lines.push(`*Order #:* ${order.orderNumber}`);
  const orderTypeStr = order.orderType === 'takeaway' ? 'Takeaway / Parcel' : order.orderType === 'dineIn' ? 'Dine-In' : order.orderType;
  lines.push(`*Type:* ${orderTypeStr}`);

  if (options.tableLabel) {
    lines.push(`*Table:* ${options.tableLabel}`);
  } else if (order.tableId) {
    lines.push(`*Table:* Table ${order.tableId}`);
  }

  const dateStr = order.createdAt
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
    : new Date().toLocaleString('en-IN');
  lines.push(`*Date:* ${dateStr}`);

  if (order.customerSnapshot?.name) {
    lines.push(`*Customer:* ${order.customerSnapshot.name}`);
  }

  lines.push('────────────────────────');
  lines.push(`*ITEMS ORDERED:*`);

  order.items.forEach((item) => {
    const unitPriceFormatted = formatMoney(item.unitPriceMinor, symbol);
    const lineTotalFormatted = formatMoney(item.lineTotalMinor, symbol);
    lines.push(`• *${item.quantity}x ${item.nameSnapshot}* (@ ${unitPriceFormatted}) = *${lineTotalFormatted}*`);
  });

  lines.push('────────────────────────');

  // Financial Breakdown
  lines.push(`*Subtotal:* ${formatMoney(order.subtotalMinor, symbol)}`);

  if (order.discountMinor > 0) {
    lines.push(`*Discount:* -${formatMoney(order.discountMinor, symbol)}`);
  }

  if (order.taxableAmountMinor && order.taxableAmountMinor > 0) {
    lines.push(`*Taxable Amount:* ${formatMoney(order.taxableAmountMinor, symbol)}`);
  }

  if (order.cgstMinor > 0) {
    lines.push(`*CGST:* ${formatMoney(order.cgstMinor, symbol)}`);
  }
  if (order.sgstMinor > 0) {
    lines.push(`*SGST:* ${formatMoney(order.sgstMinor, symbol)}`);
  }
  if (order.igstMinor > 0) {
    lines.push(`*IGST:* ${formatMoney(order.igstMinor, symbol)}`);
  }

  lines.push(`*Grand Total:* *${formatMoney(order.grandTotalMinor, symbol)}*`);
  lines.push('────────────────────────');

  // Payment Status
  const paidMinor = order.paidAmountMinor ?? 0;
  const dueMinor = order.dueAmountMinor ?? 0;

  lines.push(`*Paid Amount:* ${formatMoney(paidMinor, symbol)}`);
  if (dueMinor > 0) {
    lines.push(`*Due Amount:* ${formatMoney(dueMinor, symbol)}`);
    lines.push(`*Status:* PARTIALLY PAID ⚠️`);
  } else {
    lines.push(`*Status:* FULLY SETTLED & PAID ✅`);
  }

  // Official Public PDF Bill Link
  const restId = restaurant?.restaurantId || (restaurant as any)?.id || order.restaurantId;
  const publicBillUrl = buildPublicBillUrl(order.id, restId);
  lines.push('────────────────────────');
  lines.push(`📄 *VIEW & DOWNLOAD OFFICIAL PDF BILL:*`);
  lines.push(`👉 ${publicBillUrl}`);

  lines.push('────────────────────────');
  lines.push(`🙏 *Thank you for choosing ${restaurantName}!*`);
  lines.push(`Please visit us again soon.`);

  return lines.join('\n');
}

/**
 * Generates the complete WhatsApp Web / App share URL.
 */
export function generateWhatsAppBillUrl(
  phoneNumber: string,
  messageText: string,
  defaultCountryCode: string = '91'
): string {
  const phoneResult = formatWhatsAppPhoneNumber(phoneNumber, defaultCountryCode);
  const targetPhone = phoneResult.valid ? phoneResult.formattedInternational : '';
  const encodedText = encodeURIComponent(messageText);

  if (targetPhone) {
    return `https://wa.me/${targetPhone}?text=${encodedText}`;
  }
  return `https://api.whatsapp.com/send?text=${encodedText}`;
}

/**
 * Reliably opens a WhatsApp URL across browsers, mobile devices, and sandboxed iframes.
 * Bypasses popup blocker restrictions by creating a transient anchor element.
 */
export function openWhatsAppSafely(url: string): boolean {
  if (typeof window === 'undefined' || !url) return false;

  try {
    // 1. Direct anchor click
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      try {
        document.body.removeChild(anchor);
      } catch {}
    }, 100);
    return true;
  } catch (err) {
    console.warn('Anchor navigation failed, attempting window.open:', err);
    try {
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        window.location.href = url;
      }
      return true;
    } catch {
      window.location.href = url;
      return false;
    }
  }
}

