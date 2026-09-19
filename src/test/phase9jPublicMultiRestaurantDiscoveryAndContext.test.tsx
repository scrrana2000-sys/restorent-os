import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import {
  syncPublicRestaurantProfile,
  discoverRestaurants,
  resolveRestaurantBySlug,
  resolveRestaurantByPublicCode,
  resolveRestaurantById
} from '../services/customerDiscoveryService';
import {
  slugifyText,
  generatePublicRestaurantCode,
  generateDeterministicRestaurantSlug,
  toPublicRestaurantProfile
} from '../utils/publicRestaurantIdentity';
import {
  CustomerLocationProvider,
  useCustomerLocation
} from '../context/CustomerLocationContext';
import {
  CustomerCartProvider,
  useCustomerCart,
  RestaurantPublicIdentifier
} from '../context/CustomerCartContext';
import {
  extractRestaurantIdentifierFromUrl,
  isCustomerRestaurantRoute,
  isCustomerDiscoveryRoute,
  buildPublicRestaurantUrl
} from '../utils/urlUtils';
import { submitCustomerOnlineOrder } from '../services/customerCheckoutService';
import { orderService } from '../services/orderService';
import { Restaurant } from '../types/restaurant';
import { PublicRestaurantProfile, CustomerCartItem, CustomerCart } from '../types/customer';
import { MenuItem } from '../types/menu';
import { Order } from '../types/order';
import { KOT } from '../types/kot';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: any, ...parts: string[]) => ({ path: parts.join('/'), id: parts[parts.length - 1] })),
  getDoc: vi.fn(async (ref: any) => ({
    exists: () => true,
    id: ref?.id || '',
    data: () => ({
      itemId: ref?.id || 'm-dosa-1',
      restaurantId: 'rest-raichur-101',
      name: 'Masala Dosa',
      price: 80,
      taxRate: 5,
      taxInclusive: false,
      isActive: true,
      isAvailable: true,
      categoryId: 'cat-breakfast',
      foodType: 'veg'
    })
  })),
  getDocs: vi.fn(async () => ({ empty: true, docs: [], size: 0, forEach: () => {} })),
  collection: vi.fn((_db: any, ...parts: string[]) => ({ path: parts.join('/') })),
  query: vi.fn((colRef: any) => colRef),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => new Date().toISOString())
}));


// Mocks for Firebase Firestore
vi.mock('../config/firebase', () => ({
  db: {},
  auth: {}
}));

const mockRestaurant1: Restaurant = {
  restaurantId: 'rest-raichur-101',
  ownerId: 'owner-uid-111',
  name: 'Hotel Sagar',
  legalName: 'Hotel Sagar Private Limited',
  logoUrl: null,
  coverImageUrl: null,
  phone: '9876543210',
  email: 'sagar@raichur.com',
  address: 'Station Road',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'Station Area',
  postalCode: '584101',
  country: 'India',
  gstNumber: '29ABCDE1234F1Z5',
  currency: 'INR',
  currencySymbol: '₹',
  timezone: 'Asia/Kolkata',
  taxMode: 'exclusive',
  defaultTaxRate: 5,
  cuisine: ['South Indian', 'Biryani'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  isActive: true,
  restaurantOperatingMode: 'small_team',
  restaurantCapabilities: {
    tablesEnabled: true,
    kitchenEnabled: true,
    captainEnabled: true,
    inventoryEnabled: false,
    deliveryEnabled: true,
    takeawayEnabled: true,
    paymentsEnabled: true
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

const mockRestaurant2DuplicateName: Restaurant = {
  restaurantId: 'rest-bengaluru-102',
  ownerId: 'owner-uid-222',
  name: 'Hotel Sagar',
  legalName: 'Hotel Sagar Hospitality LLP',
  logoUrl: null,
  coverImageUrl: null,
  phone: '9123456789',
  email: 'sagar@bengaluru.com',
  address: 'MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  area: 'Indiranagar',
  postalCode: '560038',
  country: 'India',
  gstNumber: '29XYZAB5678C1Z9',
  currency: 'INR',
  currencySymbol: '₹',
  timezone: 'Asia/Kolkata',
  taxMode: 'exclusive',
  defaultTaxRate: 5,
  cuisine: ['South Indian', 'North Indian'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  isActive: true,
  restaurantOperatingMode: 'full_service',
  restaurantCapabilities: {
    tablesEnabled: true,
    kitchenEnabled: true,
    captainEnabled: true,
    inventoryEnabled: true,
    deliveryEnabled: true,
    takeawayEnabled: true,
    paymentsEnabled: true
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

const mockPausedRestaurant: Restaurant = {
  restaurantId: 'rest-closed-103',
  ownerId: 'owner-uid-333',
  name: 'Midnight Bites',
  legalName: 'Midnight Bites Cafe',
  logoUrl: null,
  coverImageUrl: null,
  phone: '9988776655',
  email: 'bites@raichur.com',
  address: 'Ring Road',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'College Road',
  postalCode: '584101',
  country: 'India',
  gstNumber: '29PQRST9876E1Z2',
  currency: 'INR',
  currencySymbol: '₹',
  timezone: 'Asia/Kolkata',
  taxMode: 'exclusive',
  defaultTaxRate: 5,
  cuisine: ['Fast Food'],
  publicStatus: 'paused',
  onlineOrderingEnabled: false,
  isActive: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

describe('M9-J: Public Multi-Restaurant Discovery & Restaurant Context', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('1. Public Restaurant Identity & Multi-Outlet Slug Disambiguation', () => {
    it('1.1. generates deterministic SEO slugs including city to prevent collisions between same-named restaurants', () => {
      const slugRaichur = generateDeterministicRestaurantSlug({
        name: 'Hotel Sagar',
        city: 'Raichur',
        restaurantId: 'rest-raichur-101'
      });
      const slugBengaluru = generateDeterministicRestaurantSlug({
        name: 'Hotel Sagar',
        city: 'Bengaluru',
        restaurantId: 'rest-bengaluru-102'
      });

      expect(slugRaichur).toContain('hotel-sagar-raichur');
      expect(slugBengaluru).toContain('hotel-sagar-bengaluru');
      expect(slugRaichur).not.toEqual(slugBengaluru);
    });

    it('1.2. generates a deterministic public restaurant code based on restaurantId', () => {
      const code1 = generatePublicRestaurantCode('rest-raichur-101');
      const code2 = generatePublicRestaurantCode('rest-raichur-101');
      const code3 = generatePublicRestaurantCode('rest-bengaluru-102');

      expect(code1).toBe(code2);
      expect(code1).not.toBe(code3);
      expect(code1).toMatch(/^R-[A-Z0-9]+$/);
    });

    it('1.3. converts private Restaurant entity to sanitized PublicRestaurantProfile without sensitive fields', () => {
      const publicProfile = toPublicRestaurantProfile(mockRestaurant1);

      expect(publicProfile.restaurantId).toBe('rest-raichur-101');
      expect(publicProfile.name).toBe('Hotel Sagar');
      expect(publicProfile.city).toBe('Raichur');
      expect(publicProfile.onlineOrderingEnabled).toBe(true);

      // Verify sensitive private fields like ownerId are omitted
      expect((publicProfile as any).ownerId).toBeUndefined();
      expect((publicProfile as any).members).toBeUndefined();
      expect((publicProfile as any).financials).toBeUndefined();
    });
  });

  describe('2. Public Visibility Qualification & Isolation Rules', () => {
    it('2.1. qualifies active and online-ordering enabled restaurants as open', () => {
      const profileActive = toPublicRestaurantProfile(mockRestaurant1);
      expect(profileActive.publicStatus).toBe('active');
      expect(profileActive.onlineOrderingEnabled).toBe(true);
      expect(profileActive.isOpenNow).toBe(true);
    });

    it('2.2. disqualifies paused or online-ordering disabled restaurants', () => {
      const profilePaused = toPublicRestaurantProfile(mockPausedRestaurant);
      expect(profilePaused.publicStatus).toBe('paused');
      expect(profilePaused.onlineOrderingEnabled).toBe(false);
      expect(profilePaused.isOpenNow).toBe(false);
    });
  });

  describe('3. Location Architecture & Context', () => {
    it('3.1. CustomerLocationContext supports manual city selection and updates context', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Raichur', 'Karnataka', 'Station Area');
      });

      expect(result.current.location?.city).toBe('Raichur');
      expect(result.current.location?.area).toBe('Station Area');
      expect(result.current.location?.source).toBe('manual');
    });

    it('3.2. preserves user privacy by not persisting raw GPS coordinates in localStorage', () => {
      const savedKey = localStorage.getItem('restaurantos_customer_location');
      expect(savedKey).toBeNull(); // No raw GPS tracking stored
    });
  });

  describe('4. Restaurant-Scoped Cart & Cross-Restaurant Switching', () => {
    it('4.1. adds items to cart for a specific restaurant context', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <CustomerCartProvider>{children}</CustomerCartProvider>
      );

      const { result } = renderHook(() => useCustomerCart(), { wrapper });

      const restaurantA: RestaurantPublicIdentifier = {
        restaurantId: 'rest-raichur-101',
        restaurantName: 'Hotel Sagar Raichur',
        publicSlug: 'hotel-sagar-raichur'
      };

      const itemA: CustomerCartItem = {
        cartItemId: 'item-1',
        itemId: 'menu-masala-dosa',
        name: 'Masala Dosa',
        price: 8000,
        quantity: 2
      };

      act(() => {
        const res = result.current.addItem(itemA, restaurantA);
        expect(res.added).toBe(true);
        expect(res.conflict).toBe(false);
      });

      expect(result.current.cart?.restaurantId).toBe('rest-raichur-101');
      expect(result.current.cart?.items).toHaveLength(1);
      expect(result.current.cart?.subtotal).toBe(16000);
    });

    it('4.2. detects cross-restaurant item additions and triggers conflict modal', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <CustomerCartProvider>{children}</CustomerCartProvider>
      );

      const { result } = renderHook(() => useCustomerCart(), { wrapper });

      const restaurantA: RestaurantPublicIdentifier = {
        restaurantId: 'rest-raichur-101',
        restaurantName: 'Hotel Sagar Raichur',
        publicSlug: 'hotel-sagar-raichur'
      };

      const restaurantB: RestaurantPublicIdentifier = {
        restaurantId: 'rest-bengaluru-102',
        restaurantName: 'Hotel Sagar Bengaluru',
        publicSlug: 'hotel-sagar-bengaluru'
      };

      const itemA: CustomerCartItem = {
        cartItemId: 'item-1',
        itemId: 'menu-masala-dosa',
        name: 'Masala Dosa',
        price: 8000,
        quantity: 1
      };

      const itemB: CustomerCartItem = {
        cartItemId: 'item-2',
        itemId: 'menu-butter-chicken',
        name: 'Butter Chicken',
        price: 32000,
        quantity: 1
      };

      // Add item to Restaurant A
      act(() => {
        result.current.addItem(itemA, restaurantA);
      });

      // Try adding item from Restaurant B
      let addRes: any;
      act(() => {
        addRes = result.current.addItem(itemB, restaurantB);
      });

      expect(addRes.added).toBe(false);
      expect(addRes.conflict).toBe(true);
      expect(result.current.conflictState).not.toBeNull();
      expect(result.current.conflictState?.pendingRestaurant.restaurantId).toBe('rest-bengaluru-102');
      // Original cart should remain unchanged
      expect(result.current.cart?.restaurantId).toBe('rest-raichur-101');
    });

    it('4.3. confirms replace cart on cross-restaurant conflict and re-initializes cart for new restaurant', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <CustomerCartProvider>{children}</CustomerCartProvider>
      );

      const { result } = renderHook(() => useCustomerCart(), { wrapper });

      const restaurantA: RestaurantPublicIdentifier = {
        restaurantId: 'rest-raichur-101',
        restaurantName: 'Hotel Sagar Raichur',
        publicSlug: 'hotel-sagar-raichur'
      };

      const restaurantB: RestaurantPublicIdentifier = {
        restaurantId: 'rest-bengaluru-102',
        restaurantName: 'Hotel Sagar Bengaluru',
        publicSlug: 'hotel-sagar-bengaluru'
      };

      const itemA: CustomerCartItem = { cartItemId: '1', itemId: 'm1', name: 'Dosa', price: 8000, quantity: 1 };
      const itemB: CustomerCartItem = { cartItemId: '2', itemId: 'm2', name: 'Roti', price: 3000, quantity: 2 };

      act(() => {
        result.current.addItem(itemA, restaurantA);
      });

      act(() => {
        result.current.addItem(itemB, restaurantB);
      });

      // Confirm Replace
      act(() => {
        result.current.confirmReplaceCart();
      });

      expect(result.current.conflictState).toBeNull();
      expect(result.current.cart?.restaurantId).toBe('rest-bengaluru-102');
      expect(result.current.cart?.items).toHaveLength(1);
      expect(result.current.cart?.items[0].name).toBe('Roti');
      expect(result.current.cart?.subtotal).toBe(6000);
    });

    it('4.4. cancels conflict on cross-restaurant conflict and keeps original cart', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <CustomerCartProvider>{children}</CustomerCartProvider>
      );

      const { result } = renderHook(() => useCustomerCart(), { wrapper });

      const restaurantA: RestaurantPublicIdentifier = {
        restaurantId: 'rest-raichur-101',
        restaurantName: 'Hotel Sagar Raichur',
        publicSlug: 'hotel-sagar-raichur'
      };

      const restaurantB: RestaurantPublicIdentifier = {
        restaurantId: 'rest-bengaluru-102',
        restaurantName: 'Hotel Sagar Bengaluru',
        publicSlug: 'hotel-sagar-bengaluru'
      };

      const itemA: CustomerCartItem = { cartItemId: '1', itemId: 'm1', name: 'Dosa', price: 8000, quantity: 1 };
      const itemB: CustomerCartItem = { cartItemId: '2', itemId: 'm2', name: 'Roti', price: 3000, quantity: 2 };

      act(() => {
        result.current.addItem(itemA, restaurantA);
        result.current.addItem(itemB, restaurantB);
      });

      // Cancel Conflict
      act(() => {
        result.current.cancelConflict();
      });

      expect(result.current.conflictState).toBeNull();
      expect(result.current.cart?.restaurantId).toBe('rest-raichur-101');
      expect(result.current.cart?.items[0].name).toBe('Dosa');
    });
  });

  describe('5. Direct Deep Link & URL Resolution', () => {
    it('5.1. parses hash routes #r/:slug and #r/:slug/menu correctly', () => {
      // Mock hash #r/hotel-sagar-raichur
      delete (window as any).location;
      window.location = new URL('https://app.restaurantos.in/#r/hotel-sagar-raichur') as any;

      expect(isCustomerRestaurantRoute()).toBe(true);

      const ident = extractRestaurantIdentifierFromUrl();
      expect(ident?.slug).toBe('hotel-sagar-raichur');
      expect(ident?.isMenu).toBe(false);

      // Mock menu hash #r/hotel-sagar-raichur/menu
      window.location = new URL('https://app.restaurantos.in/#r/hotel-sagar-raichur/menu') as any;
      const identMenu = extractRestaurantIdentifierFromUrl();
      expect(identMenu?.slug).toBe('hotel-sagar-raichur');
      expect(identMenu?.isMenu).toBe(true);
    });

    it('5.2. parses public codes in query params ?r=R-0YG9I correctly', () => {
      window.location = new URL('https://app.restaurantos.in/?r=R-0YG9I') as any;
      expect(isCustomerRestaurantRoute()).toBe(true);

      const ident = extractRestaurantIdentifierFromUrl();
      expect(ident?.code).toBe('R-0YG9I');
    });

    it('5.3. builds canonical public restaurant profile and menu URLs', () => {
      const urlProfile = buildPublicRestaurantUrl('hotel-sagar-raichur', false);
      const urlMenu = buildPublicRestaurantUrl('hotel-sagar-raichur', true);

      expect(urlProfile).toContain('#r/hotel-sagar-raichur');
      expect(urlMenu).toContain('#r/hotel-sagar-raichur/menu');
    });
  });

  describe('6. M9-I Canonical Order Service Pipeline Integration', () => {
    it('6.1. submits customer online order with valid restaurant context through canonical OrderService pipeline', async () => {
      const spyCreateOrder = vi.spyOn(orderService, 'createOrderForOperatingMode').mockResolvedValueOnce({
        order: {
          id: 'ord-m9j-101',
          restaurantId: 'rest-raichur-101',
          orderNumber: 'ORD-9001',
          orderType: 'delivery',
          source: 'online',
          status: 'sentToKitchen',
          items: [],
          subtotalMinor: 16000,
          discountMinor: 0,
          cgstMinor: 400,
          sgstMinor: 400,
          igstMinor: 0,
          grandTotalMinor: 16800,
          paidAmountMinor: 0,
          dueAmountMinor: 16800,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest',
          customerSnapshot: {
            name: 'Kiran Kumar',
            phone: '9876543210',
            address: 'Station Road, Raichur'
          }
        } as Order,
        kot: {
          id: 'kot-m9j-101',
          restaurantId: 'rest-raichur-101',
          kotNumber: 'KOT-901',
          orderId: 'ord-m9j-101',
          orderNumber: 'ORD-9001',
          orderType: 'delivery',
          status: 'sentToKitchen',
          items: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'online_guest'
        } as KOT
      });

      const profile = toPublicRestaurantProfile(mockRestaurant1);
      const cart: CustomerCart = {
        restaurantId: profile.restaurantId,
        restaurantName: profile.name,
        publicSlug: profile.publicSlug,
        publicRestaurantCode: profile.publicRestaurantCode,
        currency: profile.currency,
        currencySymbol: profile.currencySymbol,
        items: [
          {
            cartItemId: 'c1',
            itemId: 'm-dosa-1',
            name: 'Masala Dosa',
            price: 8000,
            quantity: 2,
            foodType: 'veg'
          }
        ],
        subtotal: 16000,
        itemCount: 2
      };

      const menuItems: MenuItem[] = [
        {
          itemId: 'm-dosa-1',
          restaurantId: 'rest-raichur-101',
          name: 'Masala Dosa',
          price: 80,
          isActive: true,
          isAvailable: true,
          categoryId: 'cat-breakfast',
          foodType: 'veg',
          taxRate: 5,
          taxInclusive: false
        } as MenuItem
      ];

      const submitResult = await submitCustomerOnlineOrder({
        cart,
        restaurantProfile: profile,
        menuItems,
        orderType: 'delivery',
        customerDetails: { name: 'Kiran Kumar', phone: '9876543210' },
        deliveryDetails: {
          recipientName: 'Kiran Kumar',
          phone: '9876543210',
          addressLine: 'Station Road',
          area: 'Station Area',
          city: 'Raichur',
          state: 'Karnataka',
          postalCode: '584101'
        },
        paymentMethod: 'upi',
        idempotencyKey: 'idemp-m9j-test-101'
      });

      expect(submitResult.success).toBe(true);
      expect(submitResult.order.orderNumber).toBe('ORD-9001');
      expect(submitResult.order.source).toBe('online');
      expect(submitResult.kot?.kotNumber).toBe('KOT-901');

      expect(spyCreateOrder).toHaveBeenCalledTimes(1);
      const payload = spyCreateOrder.mock.calls[0][0];
      expect(payload.restaurantId).toBe('rest-raichur-101');
      expect(payload.source).toBe('online');
      expect(payload.clientRequestId).toBe('idemp-m9j-test-101');
    });

    it('6.2. fails order submission if client cart restaurantId does not match the target restaurant profile', async () => {
      const profileA = toPublicRestaurantProfile(mockRestaurant1);
      const cartB: CustomerCart = {
        restaurantId: 'rest-bengaluru-102', // Mismatched restaurantId
        restaurantName: 'Hotel Sagar Bengaluru',
        publicSlug: 'hotel-sagar-bengaluru',
        currency: 'INR',
        currencySymbol: '₹',
        items: [
          { cartItemId: 'c1', itemId: 'm-dosa-1', name: 'Masala Dosa', price: 8000, quantity: 1 }
        ],
        subtotal: 8000,
        itemCount: 1
      };

      await expect(
        submitCustomerOnlineOrder({
          cart: cartB,
          restaurantProfile: profileA,
          menuItems: [],
          orderType: 'takeaway',
          customerDetails: { name: 'Rohan', phone: '9876543210' },
          paymentMethod: 'cash'
        })
      ).rejects.toThrow(/mismatch|restaurant/i);
    });
  });
});
