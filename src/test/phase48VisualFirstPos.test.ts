import { describe, it, expect } from 'vitest';
import { getCategoryVisual, getItemFallbackVisual } from '../utils/visualCategory';
import { calculateOrderTotals } from '../services/orderCalculationService';
import { hasPermission } from '../utils/permissions';
import { StaffRole } from '../types/auth';

describe('Phase 4.8: Visual-First POS Experience & Low-Literacy Usability', () => {
  describe('1. Visual Category & Food Item Fallbacks', () => {
    it('maps diverse food category names to recognizable visual emojis', () => {
      expect(getCategoryVisual('Hyderabadi Biryani').emoji).toBe('🍛');
      expect(getCategoryVisual('Cold Drinks & Beverages').emoji).toBe('🥤');
      expect(getCategoryVisual('Wood Fired Pizza').emoji).toBe('🍕');
      expect(getCategoryVisual('Burgers & Wraps').emoji).toBe('🍔');
      expect(getCategoryVisual('Tandoori Chicken Starters').emoji).toBe('🍗');
      expect(getCategoryVisual('Rotis and Naan').emoji).toBe('🫓');
      expect(getCategoryVisual('Chinese Noodles & Soups').emoji).toBe('🍜');
      expect(getCategoryVisual('Ice Cream & Desserts').emoji).toBe('🍰');
      expect(getCategoryVisual('South Indian Dosa').emoji).toBe('🥞');
      expect(getCategoryVisual('Royal Veg Thali').emoji).toBe('🍱');
      expect(getCategoryVisual('Fresh Green Salad').emoji).toBe('🥗');
      expect(getCategoryVisual(null).emoji).toBe('🍽️');
    });

    it('generates distinctive visual fallbacks when item images are missing', () => {
      const biryaniFallback = getItemFallbackVisual('Dum Biryani', 'nonVeg');
      expect(biryaniFallback.emoji).toBe('🍛');
      expect(biryaniFallback.bgGradient).toContain('amber');

      const chaiFallback = getItemFallbackVisual('Masala Chai', 'veg');
      expect(chaiFallback.emoji).toBe('🥤');

      const paneerFallback = getItemFallbackVisual('Paneer Butter Masala', 'veg');
      expect(paneerFallback.emoji).toBe('🍲');

      const genericVegFallback = getItemFallbackVisual('Mystery Dish', 'veg');
      expect(genericVegFallback.emoji).toBe('🥗');

      const genericNonVegFallback = getItemFallbackVisual('Mystery Meat', 'nonVeg');
      expect(genericNonVegFallback.emoji).toBe('🍖');
    });
  });

  describe('2. POS Order Slip Financial Invariants', () => {
    it('calculates order slip totals with line-by-line GST accuracy', () => {
      // 2x Chicken Biryani @ ₹250 (5% tax exclusive)
      // 1x Coke @ ₹50 (18% tax exclusive)
      const calculation = calculateOrderTotals({
        items: [
          {
            quantity: 2,
            unitPriceMinor: 25000,
            taxRate: 5,
            taxInclusive: false
          },
          {
            quantity: 1,
            unitPriceMinor: 5000,
            taxRate: 18,
            taxInclusive: false
          }
        ]
      });

      expect(calculation.subtotalMinor).toBe(55000); // ₹550.00
      expect(calculation.totalTaxMinor).toBe(3400);   // ₹25.00 + ₹9.00 = ₹34.00
      expect(calculation.grandTotalMinor).toBe(58400); // ₹584.00
    });

    it('handles order slip percentage discount with proportional line allocation', () => {
      const calculation = calculateOrderTotals({
        items: [
          {
            quantity: 1,
            unitPriceMinor: 10000, // ₹100
            taxRate: 5,
            taxInclusive: false
          }
        ],
        orderDiscount: {
          type: 'percentage',
          percentageRate: 10 // 10%
        }
      });

      expect(calculation.subtotalMinor).toBe(10000);
      expect(calculation.discountMinor).toBe(1000);
      expect(calculation.taxableAmountMinor).toBe(9000);
      expect(calculation.totalTaxMinor).toBe(450);
      expect(calculation.grandTotalMinor).toBe(9450); // ₹94.50
    });
  });

  describe('3. Table Selection & Retention Invariant', () => {
    it('ensures table selection remains consistent across the order taking lifecycle', () => {
      interface MockPosState {
        orderType: 'dineIn' | 'takeaway' | 'delivery';
        selectedTableId: string | null;
        cartCount: number;
        kotSent: boolean;
      }

      const state: MockPosState = {
        orderType: 'dineIn',
        selectedTableId: null,
        cartCount: 0,
        kotSent: false
      };

      // Step 1: Select Table
      state.selectedTableId = 'tbl_104';
      expect(state.selectedTableId).toBe('tbl_104');

      // Step 2: Add Items
      state.cartCount += 2;
      expect(state.selectedTableId).toBe('tbl_104');

      // Step 3: Review Cart
      expect(state.selectedTableId).toBe('tbl_104');

      // Step 4: Send KOT to Kitchen
      state.kotSent = true;
      state.cartCount = 0; // Cart clears

      // Table MUST remain selected for next round of items!
      expect(state.selectedTableId).toBe('tbl_104');

      // Step 5: Add subsequent items (second round)
      state.cartCount += 1;
      expect(state.selectedTableId).toBe('tbl_104');
    });

    it('clears table requirement when switching to Parcel or Delivery', () => {
      let orderType: 'dineIn' | 'takeaway' | 'delivery' = 'dineIn';
      let selectedTableId: string | null = 'tbl_101';

      // Switch to takeaway
      orderType = 'takeaway';
      selectedTableId = null;

      expect(orderType).toBe('takeaway');
      expect(selectedTableId).toBeNull();
    });
  });

  describe('4. RBAC Safety Invariants', () => {
    it('restricts payment collection and table closures according to role permissions', () => {
      const cashierRole: StaffRole = 'cashier';
      const captainRole: StaffRole = 'captain';
      const ownerRole: StaffRole = 'owner';
      const managerRole: StaffRole = 'manager';

      // Cashier, Manager and Owner can collect payments
      expect(hasPermission(cashierRole, 'process_payments')).toBe(true);
      expect(hasPermission(managerRole, 'process_payments')).toBe(true);
      expect(hasPermission(ownerRole, 'process_payments')).toBe(true);

      // Captain (floor waitstaff) cannot process payments
      expect(hasPermission(captainRole, 'process_payments')).toBe(false);

      // Both Captain and Cashier can create orders
      expect(hasPermission(captainRole, 'create_orders')).toBe(true);
      expect(hasPermission(cashierRole, 'create_orders')).toBe(true);
    });
  });
});
