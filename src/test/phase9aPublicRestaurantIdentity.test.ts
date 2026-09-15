import { describe, it, expect } from 'vitest';
import {
  slugifyText,
  generatePublicRestaurantCode,
  generateBaseRestaurantSlug,
  generateDeterministicRestaurantSlug,
  toPublicRestaurantProfile
} from '../utils/publicRestaurantIdentity';
import { Restaurant } from '../types/restaurant';

describe('Milestone 9-A: Public Restaurant Identity & Slug Management', () => {
  describe('slugifyText', () => {
    it('normalizes uppercase, spaces, and punctuation to clean lowercase kebab-case', () => {
      expect(slugifyText('Sharma Family Restaurant & Bar!')).toBe('sharma-family-restaurant-bar');
      expect(slugifyText('  Cafe @ MG Road, Bengaluru  ')).toBe('cafe-mg-road-bengaluru');
      expect(slugifyText('Punjabi-Dhaba--Special')).toBe('punjabi-dhaba-special');
    });

    it('handles empty or special character only strings gracefully', () => {
      expect(slugifyText('')).toBe('');
      expect(slugifyText('!@#$%^&*()')).toBe('');
    });
  });

  describe('generatePublicRestaurantCode', () => {
    it('creates short, clean, collision-safe alphanumeric code from restaurantId', () => {
      const code1 = generatePublicRestaurantCode('rest_1789449559093_00yg9i');
      expect(code1).toMatch(/^R-[A-Z0-9]{5}$/);
      expect(code1).toBe('R-0YG9I');

      const code2 = generatePublicRestaurantCode('rest_init_owner_123');
      expect(code2).toBe('R-ER123');
    });

    it('falls back safely for missing restaurantId', () => {
      expect(generatePublicRestaurantCode('')).toBe('ROS-0000');
    });
  });

  describe('generateBaseRestaurantSlug', () => {
    it('creates composite slug with restaurant name, area, and city', () => {
      const slug = generateBaseRestaurantSlug('Sharma Family Restaurant', 'Raichur', 'Station Road');
      expect(slug).toBe('sharma-family-restaurant-station-road-raichur');
    });

    it('creates clean slug when area is omitted', () => {
      const slug = generateBaseRestaurantSlug('Udupi Grand', 'Bengaluru');
      expect(slug).toBe('udupi-grand-bengaluru');
    });

    it('creates clean slug when city and area are omitted', () => {
      const slug = generateBaseRestaurantSlug('Royal Biryani House');
      expect(slug).toBe('royal-biryani-house');
    });
  });

  describe('generateDeterministicRestaurantSlug', () => {
    it('safely handles duplicate restaurant names in the same city by appending deterministic restaurantId suffix', () => {
      const restA: Pick<Restaurant, 'restaurantId' | 'name' | 'city' | 'area'> = {
        restaurantId: 'rest_outlet_101a',
        name: 'Sharma Sweets',
        city: 'Raichur'
      };
      const restB: Pick<Restaurant, 'restaurantId' | 'name' | 'city' | 'area'> = {
        restaurantId: 'rest_outlet_102b',
        name: 'Sharma Sweets',
        city: 'Raichur'
      };

      const slugA = generateDeterministicRestaurantSlug(restA);
      const slugB = generateDeterministicRestaurantSlug(restB);

      expect(slugA).toBe('sharma-sweets-raichur-101a');
      expect(slugB).toBe('sharma-sweets-raichur-102b');
      expect(slugA).not.toBe(slugB);
    });
  });

  describe('toPublicRestaurantProfile', () => {
    it('maps private Restaurant document into sanitized PublicRestaurantProfile without leaking sensitive fields', () => {
      const privateRest: Restaurant = {
        restaurantId: 'rest_test_9999',
        name: 'Green Leaf Cafe',
        legalName: 'Green Leaf Hospitality LLP',
        logoUrl: 'https://cdn.example.com/logo.png',
        coverImageUrl: 'https://cdn.example.com/cover.png',
        phone: '+91 98765 43210',
        email: 'private_owner@greenleaf.io',
        address: '12 Market Lane',
        city: 'Mysuru',
        state: 'Karnataka',
        area: 'Gokulam',
        postalCode: '570002',
        country: 'India',
        gstNumber: '29AAACG0561D1Z5', // Sensitive tax identity
        currency: 'INR',
        currencySymbol: '₹',
        timezone: 'Asia/Kolkata',
        taxMode: 'exclusive',
        defaultTaxRate: 5.0,
        ownerId: 'uid_sensitive_owner_999', // Sensitive Auth UID
        createdBy: 'uid_sensitive_creator_888',
        isActive: true,
        restaurantOperatingMode: 'small_team',
        restaurantCapabilities: {
          tablesEnabled: false,
          kitchenEnabled: true,
          captainEnabled: false,
          inventoryEnabled: true,
          takeawayEnabled: true,
          deliveryEnabled: true,
          paymentsEnabled: true
        },
        publicSlug: 'green-leaf-cafe-gokulam-mysuru',
        publicRestaurantCode: 'R-GL999',
        publicStatus: 'active',
        onlineOrderingEnabled: true,
        cuisine: ['South Indian', 'Cafe', 'Beverages']
      };

      const publicProfile = toPublicRestaurantProfile(privateRest);

      // Verify public values mapped correctly
      expect(publicProfile.restaurantId).toBe('rest_test_9999');
      expect(publicProfile.publicSlug).toBe('green-leaf-cafe-gokulam-mysuru');
      expect(publicProfile.publicRestaurantCode).toBe('R-GL999');
      expect(publicProfile.name).toBe('Green Leaf Cafe');
      expect(publicProfile.city).toBe('Mysuru');
      expect(publicProfile.area).toBe('Gokulam');
      expect(publicProfile.cuisine).toEqual(['South Indian', 'Cafe', 'Beverages']);
      expect(publicProfile.takeawayEnabled).toBe(true);
      expect(publicProfile.deliveryEnabled).toBe(true);
      expect(publicProfile.onlineOrderingEnabled).toBe(true);
      expect(publicProfile.isOpenNow).toBe(true);

      // Verify sensitive fields are strictly excluded
      expect((publicProfile as any).ownerId).toBeUndefined();
      expect((publicProfile as any).createdBy).toBeUndefined();
      expect((publicProfile as any).gstNumber).toBeUndefined();
      expect((publicProfile as any).email).toBeUndefined();
      expect((publicProfile as any).defaultTaxRate).toBeUndefined();
    });

    it('provides graceful backward-compatibility defaults for legacy M8.5 restaurants without public fields', () => {
      const legacyRest: Restaurant = {
        restaurantId: 'rest_legacy_8888',
        name: 'Grand Spice',
        legalName: 'Grand Spice Resto',
        logoUrl: null,
        phone: '+91 99999 88888',
        email: 'admin@grandspice.in',
        address: 'MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
        gstNumber: '29AAAAA0000A1Z5',
        currency: 'INR',
        currencySymbol: '₹',
        timezone: 'Asia/Kolkata',
        taxMode: 'exclusive',
        defaultTaxRate: 5.0,
        ownerId: 'owner_legacy',
        isActive: true
        // publicSlug, publicRestaurantCode, cuisine, onlineOrderingEnabled all omitted
      };

      const profile = toPublicRestaurantProfile(legacyRest);

      expect(profile.restaurantId).toBe('rest_legacy_8888');
      expect(profile.publicSlug).toBe('grand-spice-bengaluru-8888');
      expect(profile.publicRestaurantCode).toBe('R-Y8888');
      expect(profile.onlineOrderingEnabled).toBe(true);
      expect(profile.cuisine).toEqual([]);
      expect(profile.publicStatus).toBe('active');
    });
  });
});
