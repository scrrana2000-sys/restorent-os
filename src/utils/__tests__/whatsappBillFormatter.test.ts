import { describe, it, expect } from 'vitest';
import {
  formatWhatsAppPhoneNumber,
  formatWhatsAppBillText,
  generateWhatsAppBillUrl
} from '../whatsappBillFormatter';
import { Order } from '../../types/order';
import { Restaurant } from '../../types/restaurant';

describe('whatsappBillFormatter', () => {
  describe('formatWhatsAppPhoneNumber', () => {
    it('should format standard 10-digit Indian phone number with 91 prefix', () => {
      const res = formatWhatsAppPhoneNumber('9876543210');
      expect(res.valid).toBe(true);
      expect(res.formattedInternational).toBe('919876543210');
      expect(res.cleanDigits).toBe('9876543210');
    });

    it('should handle phone numbers with spaces, dashes, or +91 prefix', () => {
      const res = formatWhatsAppPhoneNumber('+91 98765-43210');
      expect(res.valid).toBe(true);
      expect(res.formattedInternational).toBe('919876543210');
    });

    it('should handle leading 0 for 11-digit numbers', () => {
      const res = formatWhatsAppPhoneNumber('09876543210');
      expect(res.valid).toBe(true);
      expect(res.formattedInternational).toBe('919876543210');
    });

    it('should reject invalid or short phone numbers', () => {
      const res = formatWhatsAppPhoneNumber('12345');
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('should reject empty or null inputs', () => {
      const res = formatWhatsAppPhoneNumber('');
      expect(res.valid).toBe(false);
    });
  });

  describe('formatWhatsAppBillText', () => {
    const mockRestaurant: Partial<Restaurant> = {
      name: 'Spice Garden',
      currencySymbol: '₹',
      address: '123 MG Road, Indiranagar',
      city: 'Bengaluru',
      phone: '080-12345678',
      gstNumber: '29ABCDE1234F1Z5'
    } as any;

    const mockOrder: Order = {
      id: 'ord-123',
      restaurantId: 'rest-1',
      orderNumber: 'ORD-101',
      orderType: 'dineIn',
      source: 'pos',
      tableId: 't-4',
      status: 'completed',
      items: [
        {
          itemId: 'm-1',
          nameSnapshot: 'Paneer Butter Masala',
          shortNameSnapshot: 'Paneer Masala',
          unitPriceMinor: 25000,
          quantity: 2,
          lineSubtotalMinor: 50000,
          lineTaxMinor: 0,
          lineTotalMinor: 50000,
          taxRate: 5 as any,
          taxInclusive: true,
          discountMinor: 0
        },
        {
          itemId: 'm-2',
          nameSnapshot: 'Butter Naan',
          shortNameSnapshot: 'Naan',
          unitPriceMinor: 4000,
          quantity: 3,
          lineSubtotalMinor: 12000,
          lineTaxMinor: 0,
          lineTotalMinor: 12000,
          taxRate: 5 as any,
          taxInclusive: true,
          discountMinor: 0
        }
      ],
      subtotalMinor: 62000,
      discountMinor: 2000,
      taxableAmountMinor: 60000,
      cgstMinor: 1500,
      sgstMinor: 1500,
      igstMinor: 0,
      grandTotalMinor: 63000,
      paidAmountMinor: 63000,
      dueAmountMinor: 0,
      customerSnapshot: {
        name: 'Rahul Sharma',
        phone: '9876543210'
      },
      createdAt: { toDate: () => new Date('2026-09-13T19:30:00Z') } as any,
      updatedAt: { toDate: () => new Date('2026-09-13T20:00:00Z') } as any,
      createdBy: 'cashier-1'
    };

    it('should generate complete, formatted WhatsApp bill text with items, taxes and totals', () => {
      const text = formatWhatsAppBillText(mockOrder, mockRestaurant, { tableLabel: 'Table 4' });

      expect(text).toContain('TAX INVOICE / BILL RECEIPT');
      expect(text).toContain('SPICE GARDEN');
      expect(text).toContain('ORD-101');
      expect(text).toContain('Table 4');
      expect(text).toContain('Rahul Sharma');
      expect(text).toContain('2x Paneer Butter Masala');
      expect(text).toContain('3x Butter Naan');
      expect(text).toContain('Grand Total');
      expect(text).toContain('₹630.00');
      expect(text).toContain('FULLY SETTLED & PAID');
      expect(text).toContain('VIEW & DOWNLOAD OFFICIAL PDF BILL');
      expect(text).toContain('bill=ord-123');
      expect(text).toContain('Thank you for choosing SPICE GARDEN!');
    });

    it('should flag reprint notice when requested', () => {
      const text = formatWhatsAppBillText(mockOrder, mockRestaurant, { isReprint: true });
      expect(text).toContain('Reprint Invoice');
    });
  });

  describe('generateWhatsAppBillUrl', () => {
    it('should generate a valid wa.me URL with encoded message', () => {
      const url = generateWhatsAppBillUrl('9876543210', 'Hello World Bill');
      expect(url).toContain('https://wa.me/919876543210');
      expect(url).toContain('text=Hello%20World%20Bill');
    });
  });
});
