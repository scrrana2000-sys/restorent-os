import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import {
  CustomerCartProvider,
  useCustomerCart
} from '../context/CustomerCartContext';
import {
  calculateCustomerCartTotals,
  areCustomerCartItemsEqual,
  sanitizeCustomerCartItem,
  validateCustomerCart,
  CUSTOMER_CART_STORAGE_KEY,
  loadCustomerCartFromStorage,
  saveCustomerCartToStorage,
  clearSavedCustomerCart
} from '../services/customerCartService';
import { CustomerCartDrawer } from '../components/customer/CustomerCartDrawer';
import { CartConflictModal } from '../components/customer/CartConflictModal';
import { CustomerRestaurantMenuPage } from '../pages/customer/CustomerRestaurantMenuPage';
import { CustomerCartItem, PublicRestaurantProfile } from '../types/customer';
import { MenuItem } from '../types/menu';

const mockRestaurantA = {
  restaurantId: 'rest-alpha-101',
  restaurantName: 'Tandoori Flames',
  publicSlug: 'tandoori-flames',
  publicRestaurantCode: 'TF101',
  currency: 'INR',
  currencySymbol: '₹'
};

const mockRestaurantB = {
  restaurantId: 'rest-beta-202',
  restaurantName: 'Biryani Blues',
  publicSlug: 'biryani-blues',
  publicRestaurantCode: 'BB202',
  currency: 'INR',
  currencySymbol: '₹'
};

const mockItem1: CustomerCartItem = {
  cartItemId: 'cart-1',
  itemId: 'item-paneer-butter',
  name: 'Paneer Butter Masala',
  price: 28000, // ₹280.00 in paise
  quantity: 1,
  foodType: 'veg',
  isVeg: true
};

const mockItem2: CustomerCartItem = {
  cartItemId: 'cart-2',
  itemId: 'item-garlic-naan',
  name: 'Garlic Naan',
  price: 6000, // ₹60.00 in paise
  quantity: 2,
  foodType: 'veg',
  isVeg: true
};

describe('M9-G: Customer Cart & Service Unit Tests', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  describe('1. Cart Service & Mathematics (Integer Minor Units)', () => {
    it('calculates totals correctly in integer paise minor units', () => {
      const items: CustomerCartItem[] = [
        { ...mockItem1, quantity: 2, price: 25000 }, // 2 * 25000 = 50000
        { ...mockItem2, quantity: 3, price: 5000 }   // 3 * 5000 = 15000
      ];
      const { subtotal, itemCount } = calculateCustomerCartTotals(items);
      expect(subtotal).toBe(65000); // ₹650.00
      expect(itemCount).toBe(5);
    });

    it('returns zero for empty items list', () => {
      const { subtotal, itemCount } = calculateCustomerCartTotals([]);
      expect(subtotal).toBe(0);
      expect(itemCount).toBe(0);
    });

    it('sanitizes item quantities and clamps to safe range [1, 99]', () => {
      const itemNegative = sanitizeCustomerCartItem({ ...mockItem1, quantity: -5 });
      expect(itemNegative.quantity).toBe(1);

      const itemZero = sanitizeCustomerCartItem({ ...mockItem1, quantity: 0 });
      expect(itemZero.quantity).toBe(1);

      const itemHuge = sanitizeCustomerCartItem({ ...mockItem1, quantity: 150 });
      expect(itemHuge.quantity).toBe(99);

      const itemFloat = sanitizeCustomerCartItem({ ...mockItem1, quantity: 3.8 as any });
      expect(itemFloat.quantity).toBe(3);
    });

    it('trims special instructions and bounds length', () => {
      const longNote = 'A'.repeat(400);
      const sanitized = sanitizeCustomerCartItem({ ...mockItem1, itemNotes: longNote });
      expect(sanitized.itemNotes?.length).toBeLessThanOrEqual(250);
    });
  });

  describe('2. Item Line Identity & Deterministic Merging', () => {
    it('considers two items equal if itemId, variant, addons, and notes match', () => {
      const a: CustomerCartItem = {
        cartItemId: 'c1',
        itemId: 'pizza-1',
        name: 'Margherita',
        price: 30000,
        quantity: 1,
        selectedVariantId: 'var-large',
        selectedAddons: [{ addonId: 'add-cheese', name: 'Cheese', price: 5000 }],
        itemNotes: 'Well done'
      };

      const b: CustomerCartItem = {
        cartItemId: 'c2',
        itemId: 'pizza-1',
        name: 'Margherita',
        price: 30000,
        quantity: 2,
        selectedVariantId: 'var-large',
        selectedAddons: [{ addonId: 'add-cheese', name: 'Cheese', price: 5000 }],
        itemNotes: ' Well done ' // whitespace trimmed
      };

      expect(areCustomerCartItemsEqual(a, b)).toBe(true);
    });

    it('considers items equal when addons are in different order (sorted normalization)', () => {
      const a: CustomerCartItem = {
        cartItemId: 'c1',
        itemId: 'burger-1',
        name: 'Veggie Burger',
        price: 15000,
        quantity: 1,
        selectedAddons: [
          { addonId: 'addon-a', name: 'Jalapenos', price: 2000 },
          { addonId: 'addon-b', name: 'Extra Mayo', price: 1500 }
        ]
      };

      const b: CustomerCartItem = {
        cartItemId: 'c2',
        itemId: 'burger-1',
        name: 'Veggie Burger',
        price: 15000,
        quantity: 1,
        selectedAddons: [
          { addonId: 'addon-b', name: 'Extra Mayo', price: 1500 },
          { addonId: 'addon-a', name: 'Jalapenos', price: 2000 }
        ]
      };

      expect(areCustomerCartItemsEqual(a, b)).toBe(true);
    });

    it('distinguishes items with different variants', () => {
      const a: CustomerCartItem = { ...mockItem1, selectedVariantId: 'half' };
      const b: CustomerCartItem = { ...mockItem1, selectedVariantId: 'full' };
      expect(areCustomerCartItemsEqual(a, b)).toBe(false);
    });

    it('distinguishes items with different notes', () => {
      const a: CustomerCartItem = { ...mockItem1, itemNotes: 'Less spicy' };
      const b: CustomerCartItem = { ...mockItem1, itemNotes: 'Extra spicy' };
      expect(areCustomerCartItemsEqual(a, b)).toBe(false);
    });

    it('distinguishes items with different add-ons', () => {
      const a: CustomerCartItem = {
        ...mockItem1,
        selectedAddons: [{ addonId: 'extra-butter', name: 'Butter', price: 2000 }]
      };
      const b: CustomerCartItem = {
        ...mockItem1,
        selectedAddons: []
      };
      expect(areCustomerCartItemsEqual(a, b)).toBe(false);
    });
  });

  describe('3. LocalStorage Persistence', () => {
    it('saves and loads cart from localStorage', () => {
      const cart = {
        restaurantId: 'rest-1',
        restaurantName: 'Grand Feast',
        publicSlug: 'grand-feast',
        items: [mockItem1],
        subtotal: 28000,
        itemCount: 1
      };

      saveCustomerCartToStorage(cart);
      const loaded = loadCustomerCartFromStorage();
      expect(loaded).not.toBeNull();
      expect(loaded?.restaurantId).toBe('rest-1');
      expect(loaded?.items.length).toBe(1);
      expect(loaded?.subtotal).toBe(28000);
    });

    it('safely handles and discards corrupt localStorage data', () => {
      window.localStorage.setItem(CUSTOMER_CART_STORAGE_KEY, '{"invalidJson: true');
      const loaded = loadCustomerCartFromStorage();
      expect(loaded).toBeNull();
    });

    it('clears localStorage on clearSavedCustomerCart', () => {
      saveCustomerCartToStorage({
        restaurantId: 'rest-1',
        restaurantName: 'Grand Feast',
        publicSlug: 'grand-feast',
        items: [mockItem1],
        subtotal: 28000,
        itemCount: 1
      });

      clearSavedCustomerCart();
      expect(window.localStorage.getItem(CUSTOMER_CART_STORAGE_KEY)).toBeNull();
    });
  });

  describe('4. Stale Cart & Availability Validation', () => {
    it('detects when restaurant is closed or paused', () => {
      const cart = {
        restaurantId: 'rest-1',
        restaurantName: 'Grand Feast',
        publicSlug: 'grand-feast',
        items: [mockItem1],
        subtotal: 28000,
        itemCount: 1
      };

      const closedProfile: any = {
        restaurantId: 'rest-1',
        name: 'Grand Feast',
        publicSlug: 'grand-feast',
        publicRestaurantCode: 'GF01',
        city: 'Mumbai',
        state: 'Maharashtra',
        area: 'Bandra',
        address: 'Linking Road',
        phone: '+91 99999 00000',
        postalCode: '400050',
        country: 'India',
        logoUrl: null,
        coverImageUrl: null,
        cuisine: ['North Indian'],
        currency: 'INR',
        currencySymbol: '₹',
        publicStatus: 'closed',
        onlineOrderingEnabled: true,
        deliveryEnabled: true,
        takeawayEnabled: true
      };

      const result = validateCustomerCart(cart, closedProfile, []);
      expect(result.isValid).toBe(false);
      expect(result.isRestaurantUnavailable).toBe(true);
      expect(result.issues.some((i) => i.includes('closed'))).toBe(true);
    });

    it('detects when online ordering is disabled', () => {
      const cart = {
        restaurantId: 'rest-1',
        restaurantName: 'Grand Feast',
        publicSlug: 'grand-feast',
        items: [mockItem1],
        subtotal: 28000,
        itemCount: 1
      };

      const disabledProfile: any = {
        restaurantId: 'rest-1',
        name: 'Grand Feast',
        publicSlug: 'grand-feast',
        publicRestaurantCode: 'GF01',
        city: 'Mumbai',
        state: 'Maharashtra',
        area: 'Bandra',
        address: 'Linking Road',
        phone: '+91 99999 00000',
        postalCode: '400050',
        country: 'India',
        logoUrl: null,
        coverImageUrl: null,
        cuisine: ['North Indian'],
        currency: 'INR',
        currencySymbol: '₹',
        publicStatus: 'active',
        onlineOrderingEnabled: false,
        deliveryEnabled: true,
        takeawayEnabled: true
      };

      const result = validateCustomerCart(cart, disabledProfile, []);
      expect(result.isValid).toBe(false);
      expect(result.isOrderingDisabled).toBe(true);
    });

    it('detects deleted or out-of-stock menu items', () => {
      const cart = {
        restaurantId: 'rest-1',
        restaurantName: 'Grand Feast',
        publicSlug: 'grand-feast',
        items: [mockItem1],
        subtotal: 28000,
        itemCount: 1
      };

      const liveMenu: any[] = [
        {
          itemId: 'item-paneer-butter',
          restaurantId: 'rest-1',
          categoryId: 'cat-main',
          name: 'Paneer Butter Masala',
          shortName: 'Paneer Butter',
          description: 'Gravy dish',
          imageUrl: null,
          sku: 'SKU-PB01',
          sortOrder: 1,
          taxRate: 5,
          taxInclusive: true,
          price: 280,
          isAvailable: false, // Out of stock!
          foodType: 'veg'
        }
      ];

      const result = validateCustomerCart(cart, null, liveMenu);
      expect(result.isValid).toBe(false);
      expect(result.staleItemIds).toContain('item-paneer-butter');
      expect(result.issues.some((i) => i.includes('out of stock'))).toBe(true);
    });
  });
});

describe('M9-G: CustomerCartContext & Single Restaurant Invariant', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <CustomerCartProvider>{children}</CustomerCartProvider>
  );

  it('adds first item and scopes cart to the target restaurantId', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    expect(result.current.cart).toBeNull();

    act(() => {
      const res = result.current.addItem(mockItem1, mockRestaurantA);
      expect(res.added).toBe(true);
      expect(res.conflict).toBe(false);
    });

    expect(result.current.cart).not.toBeNull();
    expect(result.current.cart?.restaurantId).toBe(mockRestaurantA.restaurantId);
    expect(result.current.cart?.items.length).toBe(1);
    expect(result.current.cart?.itemCount).toBe(1);
    expect(result.current.cart?.subtotal).toBe(28000);
  });

  it('merges quantities when adding identical item from the same restaurant', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
    });

    act(() => {
      result.current.addItem({ ...mockItem1, quantity: 2 }, mockRestaurantA);
    });

    expect(result.current.cart?.items.length).toBe(1);
    expect(result.current.cart?.items[0].quantity).toBe(3);
    expect(result.current.cart?.itemCount).toBe(3);
    expect(result.current.cart?.subtotal).toBe(28000 * 3);
  });

  it('appends as a separate line when adding different item or variant from same restaurant', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
      result.current.addItem(mockItem2, mockRestaurantA);
    });

    expect(result.current.cart?.items.length).toBe(2);
    expect(result.current.cart?.itemCount).toBe(3); // 1 + 2
    expect(result.current.cart?.subtotal).toBe(28000 + (6000 * 2));
  });

  it('triggers conflict when attempting to add item from a different restaurant without altering current cart', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
    });

    expect(result.current.cart?.restaurantId).toBe(mockRestaurantA.restaurantId);

    // Attempt to add item from Restaurant B
    let addResult: any;
    act(() => {
      addResult = result.current.addItem(mockItem2, mockRestaurantB);
    });

    expect(addResult.added).toBe(false);
    expect(addResult.conflict).toBe(true);

    // Current cart remains completely untouched
    expect(result.current.cart?.restaurantId).toBe(mockRestaurantA.restaurantId);
    expect(result.current.cart?.items.length).toBe(1);
    expect(result.current.cart?.items[0].itemId).toBe(mockItem1.itemId);

    // Conflict state is populated
    expect(result.current.conflictState).not.toBeNull();
    expect(result.current.conflictState?.pendingRestaurant.restaurantId).toBe(mockRestaurantB.restaurantId);
    expect(result.current.conflictState?.pendingItem.itemId).toBe(mockItem2.itemId);
  });

  it('cancelConflict dismisses conflict state without modifying existing cart', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
      result.current.addItem(mockItem2, mockRestaurantB);
    });

    expect(result.current.conflictState).not.toBeNull();

    act(() => {
      result.current.cancelConflict();
    });

    expect(result.current.conflictState).toBeNull();
    expect(result.current.cart?.restaurantId).toBe(mockRestaurantA.restaurantId);
    expect(result.current.cart?.items.length).toBe(1);
  });

  it('confirmReplaceCart clears old restaurant cart and establishes new restaurant cart with pending item', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
      result.current.addItem(mockItem2, mockRestaurantB);
    });

    expect(result.current.conflictState).not.toBeNull();

    act(() => {
      result.current.confirmReplaceCart();
    });

    expect(result.current.conflictState).toBeNull();
    expect(result.current.cart?.restaurantId).toBe(mockRestaurantB.restaurantId);
    expect(result.current.cart?.restaurantName).toBe(mockRestaurantB.restaurantName);
    expect(result.current.cart?.items.length).toBe(1);
    expect(result.current.cart?.items[0].itemId).toBe(mockItem2.itemId);
    expect(result.current.cart?.itemCount).toBe(2);
  });

  it('updateQuantity updates item count and subtotal', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
    });

    const cartItemId = result.current.cart!.items[0].cartItemId;

    act(() => {
      result.current.updateQuantity(cartItemId, 4);
    });

    expect(result.current.cart?.items[0].quantity).toBe(4);
    expect(result.current.cart?.itemCount).toBe(4);
    expect(result.current.cart?.subtotal).toBe(28000 * 4);
  });

  it('updateQuantity with 0 or negative removes the item', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
    });

    const cartItemId = result.current.cart!.items[0].cartItemId;

    act(() => {
      result.current.updateQuantity(cartItemId, 0);
    });

    expect(result.current.cart).toBeNull();
  });

  it('removeItem removes line item and resets cart if empty', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
      result.current.addItem(mockItem2, mockRestaurantA);
    });

    expect(result.current.cart?.items.length).toBe(2);
    const item1Id = result.current.cart!.items[0].cartItemId;
    const item2Id = result.current.cart!.items[1].cartItemId;

    act(() => {
      result.current.removeItem(item1Id);
    });

    expect(result.current.cart?.items.length).toBe(1);
    expect(result.current.cart?.items[0].cartItemId).toBe(item2Id);

    act(() => {
      result.current.removeItem(item2Id);
    });

    expect(result.current.cart).toBeNull();
  });

  it('clearCart resets cart completely', () => {
    const { result } = renderHook(() => useCustomerCart(), { wrapper });

    act(() => {
      result.current.addItem(mockItem1, mockRestaurantA);
    });

    act(() => {
      result.current.clearCart();
    });

    expect(result.current.cart).toBeNull();
  });
});

describe('M9-G: CustomerCartDrawer & CartConflictModal UI Components', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders CustomerCartDrawer with items, quantities, subtotal, and checkout CTA', () => {
    const initialCart = {
      restaurantId: mockRestaurantA.restaurantId,
      restaurantName: mockRestaurantA.restaurantName,
      publicSlug: mockRestaurantA.publicSlug,
      items: [
        { ...mockItem1, quantity: 2 },
        { ...mockItem2, quantity: 1 }
      ],
      subtotal: (28000 * 2) + 6000,
      itemCount: 3
    };

    render(
      <CustomerCartProvider initialCart={initialCart}>
        <CustomerCartDrawer isOpen={true} />
      </CustomerCartProvider>
    );

    expect(screen.getByText('Your Order')).toBeDefined();
    expect(screen.getByText(mockRestaurantA.restaurantName)).toBeDefined();
    expect(screen.getByText('Paneer Butter Masala')).toBeDefined();
    expect(screen.getByText('Garlic Naan')).toBeDefined();
    expect(screen.getByText('Proceed to Checkout')).toBeDefined();
  });

  it('renders empty state when cart has no items', () => {
    render(
      <CustomerCartProvider initialCart={null}>
        <CustomerCartDrawer isOpen={true} />
      </CustomerCartProvider>
    );

    expect(screen.getByText('Your cart is empty')).toBeDefined();
  });

  it('renders CartConflictModal and handles Keep Current Cart vs Clear & Add actions', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <CustomerCartProvider>
        <CartConflictModal
          isOpen={true}
          currentRestaurantName="Tandoori Flames"
          pendingRestaurantName="Biryani Blues"
          pendingItemName="Hyderabadi Biryani"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </CustomerCartProvider>
    );

    expect(screen.getByText('Replace items in cart?')).toBeDefined();
    expect(screen.getByText('Tandoori Flames')).toBeDefined();
    expect(screen.getByText('Biryani Blues')).toBeDefined();
    expect(screen.getByText('Hyderabadi Biryani')).toBeDefined();

    fireEvent.click(screen.getByText('Keep Current Cart'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Clear & Add'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
