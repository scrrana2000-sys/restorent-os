import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  submitCustomerOnlineOrder,
  mapCustomerCartToCartState,
  SubmitCustomerOnlineOrderInput
} from '../services/customerCheckoutService';
import { CustomerCheckoutModal } from '../components/customer/CustomerCheckoutModal';
import { CustomerCartProvider, useCustomerCart } from '../context/CustomerCartContext';
import { orderService } from '../services/orderService';
import * as subscriptionService from '../services/subscriptionService';
import { getPlanById } from '../config/subscriptionPlans';
import {
  CustomerCart,
  CustomerCartItem,
  PublicRestaurantProfile,
  CustomerCheckoutIntent
} from '../types/customer';
import { MenuItem } from '../types/menu';
import { Order } from '../types/order';
import { KOT } from '../types/kot';

vi.mock('../config/firebase', () => ({
  db: {},
  auth: { currentUser: null }
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: any, ...parts: string[]) => ({ path: parts.join('/'), id: parts[parts.length - 1] })),
  getDoc: vi.fn(async (ref: any) => {
    const id = ref?.id || '';
    const item = id === 'item-paneer-tikka'
      ? { itemId: id, restaurantId: 'rest-online-901', name: 'Paneer Tikka', price: 280, taxRate: 5, taxInclusive: false, isActive: true, isAvailable: true, categoryId: 'cat-starters', foodType: 'veg' }
      : { itemId: id, restaurantId: 'rest-online-901', name: 'Mango Lassi', price: 90, taxRate: 5, taxInclusive: false, isActive: true, isAvailable: true, categoryId: 'cat-beverages', foodType: 'veg' };
    return {
      exists: () => true,
      id,
      data: () => item
    };
  }),
  getDocs: vi.fn(async () => ({ empty: true, docs: [], size: 0, forEach: () => {} })),
  collection: vi.fn((_db: any, ...parts: string[]) => ({ path: parts.join('/') })),
  query: vi.fn((colRef: any) => colRef),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => new Date().toISOString())
}));


const mockRestaurantProfile: PublicRestaurantProfile = {
  restaurantId: 'rest-online-901',
  publicSlug: 'spice-junction',
  publicRestaurantCode: 'SJ901',
  name: 'Spice Junction',
  logoUrl: null,
  coverImageUrl: null,
  phone: '9876543210',
  address: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  area: 'Indiranagar',
  postalCode: '560038',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['Indian', 'South Indian'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockCartItem1: CustomerCartItem = {
  cartItemId: 'cart-line-1',
  itemId: 'item-paneer-tikka',
  name: 'Paneer Tikka',
  price: 28000, // ₹280.00
  quantity: 2,
  foodType: 'veg'
};

const mockCartItem2: CustomerCartItem = {
  cartItemId: 'cart-line-2',
  itemId: 'item-mango-lassi',
  name: 'Mango Lassi',
  price: 9000, // ₹90.00
  quantity: 1,
  foodType: 'veg'
};

const mockCart: CustomerCart = {
  restaurantId: 'rest-online-901',
  restaurantName: 'Spice Junction',
  publicSlug: 'spice-junction',
  publicRestaurantCode: 'SJ901',
  currency: 'INR',
  currencySymbol: '₹',
  items: [mockCartItem1, mockCartItem2],
  subtotal: 65000, // ₹650.00
  itemCount: 3
};

const mockMenuItems: MenuItem[] = [
  {
    itemId: 'item-paneer-tikka',
    restaurantId: 'rest-online-901',
    name: 'Paneer Tikka',
    price: 280,
    isActive: true,
    isAvailable: true,
    categoryId: 'cat-starters',
    foodType: 'veg',
    taxRate: 5,
    taxInclusive: false
  } as MenuItem,
  {
    itemId: 'item-mango-lassi',
    restaurantId: 'rest-online-901',
    name: 'Mango Lassi',
    price: 90,
    isActive: true,
    isAvailable: true,
    categoryId: 'cat-beverages',
    foodType: 'veg',
    taxRate: 5,
    taxInclusive: false
  } as MenuItem
];

describe('Phase M9-I: Customer Online Order Submission', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(subscriptionService, 'getActivePlanEntitlements').mockResolvedValue({
      status: 'active',
      hasActiveSubscription: true,
      hasValidTrial: false,
      isSubscriptionExpired: false,
      isExpiringSoon: false,
      daysRemaining: 30,
      hoursRemaining: 0,
      canPerformOperationalActions: true,
      plan: getPlanById('growth')
    });
  });

  describe('mapCustomerCartToCartState', () => {
    it('1. maps CustomerCartItem array to canonical CartState correctly', () => {
      const cartState = mapCustomerCartToCartState([mockCartItem1, mockCartItem2]);
      expect(cartState.items).toHaveLength(2);
      expect(cartState.items[0].itemId).toBe('item-paneer-tikka');
      expect(cartState.items[0].nameSnapshot).toBe('Paneer Tikka');
      expect(cartState.items[0].unitPriceMinor).toBe(28000);
      expect(cartState.items[0].quantity).toBe(2);

      expect(cartState.items[1].itemId).toBe('item-mango-lassi');
      expect(cartState.items[1].unitPriceMinor).toBe(9000);
      expect(cartState.items[1].quantity).toBe(1);
    });

    it('2. includes variants and addons in item modifiers', () => {
      const complexItem: CustomerCartItem = {
        cartItemId: 'complex-1',
        itemId: 'item-pizza',
        name: 'Custom Pizza',
        price: 45000,
        quantity: 1,
        selectedVariantId: 'var-large',
        selectedVariantName: 'Large 12 inch',
        selectedAddons: [
          { addonId: 'addon-cheese', name: 'Extra Cheese', price: 5000 }
        ]
      };

      const cartState = mapCustomerCartToCartState([complexItem]);
      expect(cartState.items[0].modifiers).toHaveLength(2);
      expect(cartState.items[0].modifiers![0].name).toBe('Option: Large 12 inch');
      expect(cartState.items[0].modifiers![1].name).toBe('Extra Cheese');
      expect(cartState.items[0].modifiers![1].priceMinor).toBe(5000);
    });
  });

  describe('submitCustomerOnlineOrder Service Pipeline', () => {
    it('3. successfully submits a takeaway order with source = online and returns order + KOT', async () => {
      const spyCreate = vi.spyOn(orderService, 'createOrderForOperatingMode').mockResolvedValueOnce({
        order: {
          id: 'ord-online-101',
          restaurantId: 'rest-online-901',
          orderNumber: 'ORD-1001',
          orderType: 'takeaway',
          source: 'online',
          status: 'sentToKitchen',
          items: [],
          subtotalMinor: 65000,
          discountMinor: 0,
          cgstMinor: 1625,
          sgstMinor: 1625,
          igstMinor: 0,
          grandTotalMinor: 68250,
          paidAmountMinor: 0,
          dueAmountMinor: 68250,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest',
          customerSnapshot: {
            name: 'Aarav Patel',
            phone: '9876543210'
          }
        } as Order,
        kot: {
          id: 'kot-online-101',
          restaurantId: 'rest-online-901',
          kotNumber: 'KOT-101',
          orderId: 'ord-online-101',
          orderNumber: 'ORD-1001',
          orderType: 'takeaway',
          status: 'sentToKitchen',
          items: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest'
        } as KOT
      });

      const result = await submitCustomerOnlineOrder({
        cart: mockCart,
        restaurantProfile: mockRestaurantProfile,
        menuItems: mockMenuItems,
        orderType: 'takeaway',
        customerDetails: { name: 'Aarav Patel', phone: '9876543210' },
        paymentMethod: 'upi',
        idempotencyKey: 'idemp-takeaway-123'
      });

      expect(result.success).toBe(true);
      expect(result.order.orderNumber).toBe('ORD-1001');
      expect(result.order.source).toBe('online');
      expect(result.kot?.kotNumber).toBe('KOT-101');

      expect(spyCreate).toHaveBeenCalledTimes(1);
      const callArg = spyCreate.mock.calls[0][0];
      expect(callArg.restaurantId).toBe('rest-online-901');
      expect(callArg.source).toBe('online');
      expect(callArg.orderType).toBe('takeaway');
      expect(callArg.clientRequestId).toBe('idemp-takeaway-123');
      expect(callArg.customerSnapshot?.name).toBe('Aarav Patel');
      expect(callArg.customerSnapshot?.phone).toBe('9876543210');
    });

    it('4. successfully submits a delivery order with delivery address formatted in customerSnapshot', async () => {
      const spyCreate = vi.spyOn(orderService, 'createOrderForOperatingMode').mockResolvedValueOnce({
        order: {
          id: 'ord-delivery-102',
          restaurantId: 'rest-online-901',
          orderNumber: 'ORD-1002',
          orderType: 'delivery',
          source: 'online',
          status: 'sentToKitchen',
          items: [],
          subtotalMinor: 65000,
          discountMinor: 0,
          cgstMinor: 1625,
          sgstMinor: 1625,
          igstMinor: 0,
          grandTotalMinor: 68250,
          paidAmountMinor: 0,
          dueAmountMinor: 68250,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest',
          customerSnapshot: {
            name: 'Priya Sharma',
            phone: '9876543210',
            address: 'Flat 402, Lotus Residency, Koramangala, Bengaluru, 560034, Karnataka'
          }
        } as Order,
        kot: null
      });

      const result = await submitCustomerOnlineOrder({
        cart: mockCart,
        restaurantProfile: mockRestaurantProfile,
        menuItems: mockMenuItems,
        orderType: 'delivery',
        customerDetails: { name: 'Priya Sharma', phone: '9876543210' },
        deliveryDetails: {
          recipientName: 'Priya Sharma',
          phone: '9876543210',
          addressLine: 'Flat 402, Lotus Residency',
          area: 'Koramangala',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560034',
          deliveryInstructions: 'Ring bell twice'
        },
        paymentMethod: 'cash'
      });

      expect(result.success).toBe(true);
      expect(result.order.orderType).toBe('delivery');

      const callArg = spyCreate.mock.calls[0][0];
      expect(callArg.orderType).toBe('delivery');
      expect(callArg.source).toBe('online');
      expect(callArg.notes).toBe('Delivery Instruction: Ring bell twice');
      expect(callArg.customerSnapshot?.address).toContain('Flat 402, Lotus Residency');
      expect(callArg.customerSnapshot?.address).toContain('560034');
    });

    it('5. fails submission if restaurant is closed or online ordering is disabled', async () => {
      const closedProfile: PublicRestaurantProfile = {
        ...mockRestaurantProfile,
        publicStatus: 'closed'
      };

      await expect(
        submitCustomerOnlineOrder({
          cart: mockCart,
          restaurantProfile: closedProfile,
          menuItems: mockMenuItems,
          orderType: 'takeaway',
          customerDetails: { name: 'Rahul', phone: '9876543210' },
          paymentMethod: 'cash'
        })
      ).rejects.toThrow(/not accepting orders/i);
    });

    it('6. fails submission if cart contains unavailable items', async () => {
      const unavailableItems: MenuItem[] = [
        {
          ...mockMenuItems[0],
          isAvailable: false
        }
      ];

      await expect(
        submitCustomerOnlineOrder({
          cart: mockCart,
          restaurantProfile: mockRestaurantProfile,
          menuItems: unavailableItems,
          orderType: 'takeaway',
          customerDetails: { name: 'Rahul', phone: '9876543210' },
          paymentMethod: 'cash'
        })
      ).rejects.toThrow(/out of stock|unavailable/i);
    });

    it('7. accepts a validated CustomerCheckoutIntent directly for submission', async () => {
      const spyCreate = vi.spyOn(orderService, 'createOrderForOperatingMode').mockResolvedValueOnce({
        order: {
          id: 'ord-intent-103',
          restaurantId: 'rest-online-901',
          orderNumber: 'ORD-1003',
          orderType: 'takeaway',
          source: 'online',
          status: 'confirmed',
          items: [],
          subtotalMinor: 65000,
          discountMinor: 0,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 0,
          grandTotalMinor: 65000,
          paidAmountMinor: 0,
          dueAmountMinor: 65000,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest'
        } as Order,
        kot: null
      });

      const intent: CustomerCheckoutIntent = {
        restaurantId: 'rest-online-901',
        restaurantName: 'Spice Junction',
        orderType: 'takeaway',
        customerDetails: { name: 'Ananya Roy', phone: '9876543210' },
        items: mockCart.items,
        subtotal: 65000,
        paymentMethod: 'upi',
        idempotencyKey: 'idemp-intent-999',
        createdAt: new Date().toISOString()
      };

      const result = await submitCustomerOnlineOrder({
        intent,
        restaurantProfile: mockRestaurantProfile,
        menuItems: mockMenuItems
      });

      expect(result.success).toBe(true);
      expect(spyCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          clientRequestId: 'idemp-intent-999',
          source: 'online'
        })
      );
    });

    it('8. fails submission if mandatory phone number is invalid or missing', async () => {
      await expect(
        submitCustomerOnlineOrder({
          cart: mockCart,
          restaurantProfile: mockRestaurantProfile,
          menuItems: mockMenuItems,
          orderType: 'takeaway',
          customerDetails: { name: 'Rohan', phone: '123' },
          paymentMethod: 'cash'
        })
      ).rejects.toThrow(/phone|mobile/i);
    });

    it('9. fails submission if delivery address is missing for delivery order', async () => {
      await expect(
        submitCustomerOnlineOrder({
          cart: mockCart,
          restaurantProfile: mockRestaurantProfile,
          menuItems: mockMenuItems,
          orderType: 'delivery',
          customerDetails: { name: 'Rohan', phone: '9876543210' },
          deliveryDetails: {
            recipientName: 'Rohan',
            phone: '9876543210',
            addressLine: '',
            area: '',
            city: '',
            state: '',
            postalCode: ''
          },
          paymentMethod: 'cash'
        })
      ).rejects.toThrow(/address/i);
    });

    it('10. generates a clientRequestId if idempotencyKey is omitted', async () => {
      const spyCreate = vi.spyOn(orderService, 'createOrderForOperatingMode').mockResolvedValueOnce({
        order: {
          id: 'ord-auto-idemp',
          restaurantId: 'rest-online-901',
          orderNumber: 'ORD-1004',
          orderType: 'takeaway',
          source: 'online',
          status: 'confirmed',
          items: [],
          subtotalMinor: 65000,
          discountMinor: 0,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 0,
          grandTotalMinor: 65000,
          paidAmountMinor: 0,
          dueAmountMinor: 65000,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest'
        } as Order,
        kot: null
      });

      await submitCustomerOnlineOrder({
        cart: mockCart,
        restaurantProfile: mockRestaurantProfile,
        menuItems: mockMenuItems,
        orderType: 'takeaway',
        customerDetails: { name: 'Siddharth', phone: '9876543210' },
        paymentMethod: 'upi'
      });

      expect(spyCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          clientRequestId: expect.stringMatching(/^online_order_rest-online-901_/),
          source: 'online'
        })
      );
    });
  });

  describe('CustomerCheckoutModal UI Integration Component', () => {
    const TestModalWrapper: React.FC = () => {
      const [isOpen, setIsOpen] = React.useState(true);
      return (
        <CustomerCartProvider initialCart={mockCart}>
          <CustomerCheckoutModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            restaurantProfile={mockRestaurantProfile}
            menuItems={mockMenuItems}
          />
        </CustomerCartProvider>
      );
    };

    it('8. renders form, fills contact details, and submits online order through the UI modal', async () => {
      vi.spyOn(orderService, 'createOrderForOperatingMode').mockResolvedValueOnce({
        order: {
          id: 'ord-ui-201',
          restaurantId: 'rest-online-901',
          orderNumber: 'ORD-2001',
          orderType: 'takeaway',
          source: 'online',
          status: 'sentToKitchen',
          items: [],
          subtotalMinor: 65000,
          discountMinor: 0,
          cgstMinor: 1625,
          sgstMinor: 1625,
          igstMinor: 0,
          grandTotalMinor: 68250,
          paidAmountMinor: 0,
          dueAmountMinor: 68250,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest',
          customerSnapshot: { name: 'Vikram Seth', phone: '9876543210' }
        } as Order,
        kot: {
          id: 'kot-ui-201',
          restaurantId: 'rest-online-901',
          kotNumber: 'KOT-201',
          orderId: 'ord-ui-201',
          orderNumber: 'ORD-2001',
          orderType: 'takeaway',
          status: 'sentToKitchen',
          items: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest'
        } as KOT
      });

      render(<TestModalWrapper />);

      // Fill in Name and Phone
      const nameInput = screen.getByLabelText(/Full Name/i);
      const phoneInput = screen.getByLabelText(/Mobile Number/i);

      fireEvent.change(nameInput, { target: { value: 'Vikram Seth' } });
      fireEvent.change(phoneInput, { target: { value: '9876543210' } });

      // Click Review Order
      const reviewBtn = screen.getByRole('button', { name: /Review Order/i });
      fireEvent.click(reviewBtn);

      // Verify Review screen appears
      expect(screen.getByText('Review Your Order')).toBeInTheDocument();
      expect(screen.getByText('Vikram Seth')).toBeInTheDocument();

      // Click Place Online Order
      const placeOrderBtn = screen.getByRole('button', { name: /Place Online Order/i });
      await act(async () => {
        fireEvent.click(placeOrderBtn);
      });

      // Verify Order Confirmation screen appears with Order Number
      expect(screen.getByText('Order Placed Successfully!')).toBeInTheDocument();
      expect(screen.getByText('ORD-2001')).toBeInTheDocument();
      expect(screen.getByText('KOT-201')).toBeInTheDocument();
    });

    it('9. shows error banner in modal if order submission fails', async () => {
      vi.spyOn(orderService, 'createOrderForOperatingMode').mockRejectedValueOnce(
        new Error('Payment gateway error or stock exhausted')
      );

      render(<TestModalWrapper />);

      fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Neha Kapoor' } });
      fireEvent.change(screen.getByLabelText(/Mobile Number/i), { target: { value: '9876543210' } });

      fireEvent.click(screen.getByRole('button', { name: /Review Order/i }));

      const placeOrderBtn = screen.getByRole('button', { name: /Place Online Order/i });
      await act(async () => {
        fireEvent.click(placeOrderBtn);
      });

      // Error banner should be rendered
      expect(screen.getByText(/Payment gateway error or stock exhausted/i)).toBeInTheDocument();
    });
  });
});
