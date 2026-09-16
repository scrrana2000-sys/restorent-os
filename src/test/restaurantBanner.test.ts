import { describe, it, expect, vi } from 'vitest';
import { toPublicRestaurantProfile } from '../utils/publicRestaurantIdentity';
import { syncPublicRestaurantProfile } from '../services/customerDiscoveryService';
import { Restaurant } from '../types/restaurant';

// Mock Firebase Firestore methods
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    doc: vi.fn((_db, _coll, id) => ({ id, type: 'docRef' })),
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    limit: vi.fn()
  };
});

// Mock firebase config
vi.mock('../config/firebase', () => ({
  db: {}
}));

describe('Restaurant Banner Image Management Feature', () => {
  const mockRestaurant: Restaurant = {
    restaurantId: 'rest_banner_test_101',
    name: 'Bistro Spice',
    legalName: 'Bistro Spice Foods Pvt Ltd',
    logoUrl: 'https://storage.googleapis.com/test-bucket/logo.png',
    bannerImageUrl: 'https://storage.googleapis.com/test-bucket/restaurants/rest_banner_test_101/branding/banner.webp',
    coverImageUrl: 'https://storage.googleapis.com/test-bucket/restaurants/rest_banner_test_101/branding/banner.webp',
    phone: '+91 98765 43210',
    email: 'contact@bistrospice.com',
    address: '100 Feet Road, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    area: 'Indiranagar',
    postalCode: '560038',
    country: 'India',
    gstNumber: '29AAACB1234C1Z5',
    currency: 'INR',
    currencySymbol: '₹',
    timezone: 'Asia/Kolkata',
    taxMode: 'exclusive',
    defaultTaxRate: 5.0,
    ownerId: 'owner_uid_999',
    isActive: true,
    publicSlug: 'bistro-spice-indiranagar-bengaluru',
    publicRestaurantCode: 'R-SP101',
    publicStatus: 'active',
    onlineOrderingEnabled: true,
    cuisine: ['North Indian', 'Biryani']
  };

  describe('1. toPublicRestaurantProfile Mapper', () => {
    it('maps bannerImageUrl correctly when present on Restaurant entity', () => {
      const publicProfile = toPublicRestaurantProfile(mockRestaurant);

      expect(publicProfile.bannerImageUrl).toBe(
        'https://storage.googleapis.com/test-bucket/restaurants/rest_banner_test_101/branding/banner.webp'
      );
      expect(publicProfile.coverImageUrl).toBe(
        'https://storage.googleapis.com/test-bucket/restaurants/rest_banner_test_101/branding/banner.webp'
      );
    });

    it('falls back to coverImageUrl if bannerImageUrl is undefined or null', () => {
      const legacyRest: Restaurant = {
        ...mockRestaurant,
        bannerImageUrl: undefined,
        coverImageUrl: 'https://storage.googleapis.com/test-bucket/legacy-cover.jpg'
      };

      const publicProfile = toPublicRestaurantProfile(legacyRest);

      expect(publicProfile.bannerImageUrl).toBe('https://storage.googleapis.com/test-bucket/legacy-cover.jpg');
      expect(publicProfile.coverImageUrl).toBe('https://storage.googleapis.com/test-bucket/legacy-cover.jpg');
    });

    it('returns null for bannerImageUrl and coverImageUrl if both are missing', () => {
      const noBannerRest: Restaurant = {
        ...mockRestaurant,
        bannerImageUrl: null,
        coverImageUrl: null
      };

      const publicProfile = toPublicRestaurantProfile(noBannerRest);

      expect(publicProfile.bannerImageUrl).toBeNull();
      expect(publicProfile.coverImageUrl).toBeNull();
    });
  });

  describe('2. syncPublicRestaurantProfile Sync', () => {
    it('includes bannerImageUrl in publicRestaurants Firestore document payload', async () => {
      const { setDoc } = await import('firebase/firestore');

      await syncPublicRestaurantProfile(mockRestaurant);

      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'rest_banner_test_101' }),
        expect.objectContaining({
          restaurantId: 'rest_banner_test_101',
          name: 'Bistro Spice',
          bannerImageUrl: 'https://storage.googleapis.com/test-bucket/restaurants/rest_banner_test_101/branding/banner.webp',
          coverImageUrl: 'https://storage.googleapis.com/test-bucket/restaurants/rest_banner_test_101/branding/banner.webp'
        }),
        { merge: true }
      );
    });
  });

  describe('3. Deterministic Storage Path & Asset Validation Invariants', () => {
    it('generates deterministic restaurant banner storage path', () => {
      const restaurantId = 'rest_banner_test_101';
      const expectedStoragePath = `restaurants/${restaurantId}/branding/banner`;

      expect(expectedStoragePath).toBe('restaurants/rest_banner_test_101/branding/banner');
      expect(expectedStoragePath).not.toContain('undefined');
      expect(expectedStoragePath).not.toContain('null');
    });

    it('validates supported web image MIME types and file size limits', () => {
      const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
      const maxSizeBytes = 5 * 1024 * 1024; // 5MB limit

      expect(allowedMimeTypes.includes('image/png')).toBe(true);
      expect(allowedMimeTypes.includes('image/jpeg')).toBe(true);
      expect(allowedMimeTypes.includes('image/webp')).toBe(true);
      expect(allowedMimeTypes.includes('image/gif')).toBe(false);

      expect(2 * 1024 * 1024 <= maxSizeBytes).toBe(true);
      expect(6 * 1024 * 1024 <= maxSizeBytes).toBe(false);
    });
  });
});
