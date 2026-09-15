import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  discoverRestaurants,
  resolveRestaurantBySlug,
  resolveRestaurantByPublicCode,
  syncPublicRestaurantProfile,
  normalizeLocationTerm
} from '../services/customerDiscoveryService';
import { Restaurant } from '../types/restaurant';
import { PublicRestaurantProfile } from '../types/customer';

// Mock Firebase Firestore functions
vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP')
  };
});

vi.mock('../config/firebase', () => ({
  db: {},
  auth: { currentUser: null }
}));

import { getDocs, setDoc } from 'firebase/firestore';

describe('Milestone 9-B: Public Restaurant Discovery Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeLocationTerm', () => {
    it('trims and lowercases input terms', () => {
      expect(normalizeLocationTerm('  Raichur ')).toBe('raichur');
      expect(normalizeLocationTerm('Station Road')).toBe('station road');
      expect(normalizeLocationTerm('')).toBe('');
      expect(normalizeLocationTerm(undefined)).toBe('');
    });
  });

  describe('discoverRestaurants (City & Area Scoped Discovery)', () => {
    it('returns empty result when city is missing or empty, avoiding nationwide dump', async () => {
      const result = await discoverRestaurants({ city: '' });
      expect(result.restaurants).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.totalReturned).toBe(0);
      expect(getDocs).not.toHaveBeenCalled();
    });

    it('queries restaurants scoped to the requested city and filters by active public status & online ordering', async () => {
      const mockDocs = [
        {
          id: 'rest_raichur_1',
          data: () => ({
            restaurantId: 'rest_raichur_1',
            publicSlug: 'sharma-family-restaurant-raichur-01',
            publicRestaurantCode: 'R-RC01',
            name: 'Sharma Family Restaurant',
            city: 'Raichur',
            cityLower: 'raichur',
            area: 'Station Road',
            areaLower: 'station road',
            cuisine: ['North Indian', 'Thali'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: true,
            isOpenNow: true
          })
        },
        {
          id: 'rest_raichur_2',
          data: () => ({
            restaurantId: 'rest_raichur_2',
            publicSlug: 'udupi-krishna-raichur-02',
            publicRestaurantCode: 'R-RC02',
            name: 'Udupi Krishna Grand',
            city: 'Raichur',
            cityLower: 'raichur',
            area: 'Market Yard',
            areaLower: 'market yard',
            cuisine: ['South Indian', 'Breakfast'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: false,
            isOpenNow: true
          })
        }
      ];

      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        forEach: (cb: any) => mockDocs.forEach(cb)
      });

      const result = await discoverRestaurants({ city: 'Raichur' });

      expect(result.queryCity).toBe('Raichur');
      expect(result.totalReturned).toBe(2);
      expect(result.restaurants.length).toBe(2);
      expect(result.restaurants[0].name).toBe('Sharma Family Restaurant');
      expect(result.restaurants[1].name).toBe('Udupi Krishna Grand');
      expect((result.restaurants[0] as any).ownerId).toBeUndefined();
      expect((result.restaurants[0] as any).gstNumber).toBeUndefined();
    });

    it('filters strictly by area when area is specified and prioritizes exact area matches', async () => {
      const mockDocs = [
        {
          id: 'rest_1',
          data: () => ({
            restaurantId: 'rest_1',
            publicSlug: 'cafe-one-market-yard',
            publicRestaurantCode: 'R-C1',
            name: 'Cafe One',
            city: 'Raichur',
            area: 'Market Yard',
            cuisine: ['Cafe'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: true
          })
        },
        {
          id: 'rest_2',
          data: () => ({
            restaurantId: 'rest_2',
            publicSlug: 'dhaba-station-road',
            publicRestaurantCode: 'R-D2',
            name: 'Highway Dhaba',
            city: 'Raichur',
            area: 'Station Road',
            cuisine: ['Punjabi'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: true
          })
        }
      ];

      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        forEach: (cb: any) => mockDocs.forEach(cb)
      });

      const result = await discoverRestaurants({ city: 'Raichur', area: 'Station Road' });

      expect(result.totalReturned).toBe(1);
      expect(result.restaurants[0].name).toBe('Highway Dhaba');
      expect(result.restaurants[0].area).toBe('Station Road');
    });

    it('filters by cuisine and ordering capabilities (deliveryOnly, takeawayOnly)', async () => {
      const mockDocs = [
        {
          id: 'rest_veg',
          data: () => ({
            restaurantId: 'rest_veg',
            publicSlug: 'pure-veg-delight',
            publicRestaurantCode: 'R-PV',
            name: 'Pure Veg Delight',
            city: 'Bengaluru',
            area: 'Jayanagar',
            cuisine: ['South Indian', 'Pure Veg'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: false
          })
        },
        {
          id: 'rest_fastfood',
          data: () => ({
            restaurantId: 'rest_fastfood',
            publicSlug: 'burger-station',
            publicRestaurantCode: 'R-BS',
            name: 'Burger Station',
            city: 'Bengaluru',
            area: 'Indiranagar',
            cuisine: ['Fast Food', 'Burgers'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: true
          })
        }
      ];

      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        forEach: (cb: any) => mockDocs.forEach(cb)
      });

      const deliveryResult = await discoverRestaurants({
        city: 'Bengaluru',
        deliveryOnly: true
      });

      expect(deliveryResult.totalReturned).toBe(1);
      expect(deliveryResult.restaurants[0].name).toBe('Burger Station');
    });

    it('handles pagination correctly with limit and nextCursor', async () => {
      const mockDocs = Array.from({ length: 4 }, (_, i) => ({
        id: `rest_${i + 1}`,
        data: () => ({
          restaurantId: `rest_${i + 1}`,
          publicSlug: `rest-slug-${i + 1}`,
          publicRestaurantCode: `R-00${i + 1}`,
          name: `Restaurant ${i + 1}`,
          city: 'Mysuru',
          area: 'Central',
          cuisine: ['Multi-Cuisine'],
          publicStatus: 'active',
          onlineOrderingEnabled: true,
          takeawayEnabled: true,
          deliveryEnabled: true
        })
      }));

      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        forEach: (cb: any) => mockDocs.forEach(cb)
      });

      // Request limit of 3
      const result = await discoverRestaurants({ city: 'Mysuru', limit: 3 });

      expect(result.restaurants.length).toBe(3);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('rest_3');
    });

    it('supports in-city text search by restaurant name, code, or cuisine', async () => {
      const mockDocs = [
        {
          id: 'rest_biryani',
          data: () => ({
            restaurantId: 'rest_biryani',
            publicSlug: 'hyderabadi-biryani-point',
            publicRestaurantCode: 'R-HYD01',
            name: 'Hyderabadi Biryani Point',
            city: 'Hyderabad',
            area: 'Hitech City',
            cuisine: ['Biryani', 'Mughlai'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: true
          })
        },
        {
          id: 'rest_pizza',
          data: () => ({
            restaurantId: 'rest_pizza',
            publicSlug: 'wood-fired-pizza',
            publicRestaurantCode: 'R-PIZ02',
            name: 'Wood Fired Crusts',
            city: 'Hyderabad',
            area: 'Madhapur',
            cuisine: ['Italian', 'Pizza'],
            publicStatus: 'active',
            onlineOrderingEnabled: true,
            takeawayEnabled: true,
            deliveryEnabled: true
          })
        }
      ];

      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        forEach: (cb: any) => mockDocs.forEach(cb)
      });

      const searchResult = await discoverRestaurants({
        city: 'Hyderabad',
        searchQuery: 'biryani'
      });

      expect(searchResult.totalReturned).toBe(1);
      expect(searchResult.restaurants[0].name).toBe('Hyderabadi Biryani Point');
    });
  });

  describe('resolveRestaurantBySlug', () => {
    it('resolves active restaurant by exact normalized slug', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest_123',
            data: () => ({
              restaurantId: 'rest_123',
              publicSlug: 'sharma-family-restaurant-raichur',
              publicRestaurantCode: 'R-SH123',
              name: 'Sharma Family Restaurant',
              city: 'Raichur',
              state: 'Karnataka',
              area: 'Station Road',
              publicStatus: 'active',
              onlineOrderingEnabled: true,
              takeawayEnabled: true,
              deliveryEnabled: true
            })
          }
        ]
      });

      const profile = await resolveRestaurantBySlug('Sharma-Family-Restaurant-Raichur');

      expect(profile).not.toBeNull();
      expect(profile?.restaurantId).toBe('rest_123');
      expect(profile?.publicSlug).toBe('sharma-family-restaurant-raichur');
      expect(profile?.isOpenNow).toBe(true);
    });

    it('returns isOpenNow: false when restaurant is paused or closed', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest_closed',
            data: () => ({
              restaurantId: 'rest_closed',
              publicSlug: 'sunset-diner-goa',
              publicRestaurantCode: 'R-SD99',
              name: 'Sunset Diner',
              city: 'Panaji',
              publicStatus: 'closed',
              onlineOrderingEnabled: false,
              takeawayEnabled: false,
              deliveryEnabled: false
            })
          }
        ]
      });

      const profile = await resolveRestaurantBySlug('sunset-diner-goa');

      expect(profile).not.toBeNull();
      expect(profile?.isOpenNow).toBe(false);
      expect(profile?.onlineOrderingEnabled).toBe(false);
    });

    it('returns null for non-existent or invalid slug', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const profile = await resolveRestaurantBySlug('non-existent-restaurant-slug');
      expect(profile).toBeNull();
    });
  });

  describe('resolveRestaurantByPublicCode', () => {
    it('resolves unique restaurant by uppercase public code', async () => {
      (getDocs as any).mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'rest_target',
            data: () => ({
              restaurantId: 'rest_target',
              publicSlug: 'target-kitchen-delhi',
              publicRestaurantCode: 'R-0YG9I',
              name: 'Target Kitchen',
              city: 'New Delhi',
              publicStatus: 'active',
              onlineOrderingEnabled: true
            })
          }
        ]
      });

      const profile = await resolveRestaurantByPublicCode('r-0yg9i');

      expect(profile).not.toBeNull();
      expect(profile?.publicRestaurantCode).toBe('R-0YG9I');
      expect(profile?.restaurantId).toBe('rest_target');
    });

    it('returns null for invalid or empty code', async () => {
      const profile = await resolveRestaurantByPublicCode('');
      expect(profile).toBeNull();
    });
  });

  describe('syncPublicRestaurantProfile', () => {
    it('writes non-sensitive sanitized fields to publicRestaurants collection', async () => {
      const privateRest: Restaurant = {
        restaurantId: 'rest_sync_test',
        name: 'Saffron Spice',
        legalName: 'Saffron Spice Pvt Ltd',
        logoUrl: 'https://logo.png',
        phone: '+91 91234 56789',
        email: 'secret_owner@saffron.com',
        address: '10 High Street',
        city: 'Pune',
        state: 'Maharashtra',
        area: 'Koregaon Park',
        postalCode: '411001',
        country: 'India',
        gstNumber: '27AABCS1234P1Z8',
        currency: 'INR',
        currencySymbol: '₹',
        timezone: 'Asia/Kolkata',
        taxMode: 'exclusive',
        defaultTaxRate: 5.0,
        ownerId: 'owner_secret_uid',
        isActive: true,
        cuisine: ['North Indian', 'Mughlai']
      };

      (setDoc as any).mockResolvedValueOnce(undefined);

      const publicProfile = await syncPublicRestaurantProfile(privateRest);

      expect(setDoc).toHaveBeenCalledTimes(1);
      expect(publicProfile.restaurantId).toBe('rest_sync_test');
      expect(publicProfile.city).toBe('Pune');
      expect(publicProfile.area).toBe('Koregaon Park');
      expect((publicProfile as any).ownerId).toBeUndefined();
      expect((publicProfile as any).gstNumber).toBeUndefined();
    });
  });
});
