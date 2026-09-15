import { describe, it, expect } from 'vitest';
import { normalizeCityName, getCitySearchTerms } from '../utils/cityNormalization';
import { toPublicRestaurantProfile } from '../utils/publicRestaurantIdentity';
import { Restaurant } from '../types/restaurant';
import { FULL_SERVICE_CAPABILITIES } from '../config/restaurantOperatingModes';

describe('City Normalization & Public Discovery Fix Suite', () => {
  it('1. normalizes "Bangalore", "Bengaluru", "BLR", and "Bengaluru Urban" to canonical "bengaluru"', () => {
    expect(normalizeCityName('Bengaluru')).toBe('bengaluru');
    expect(normalizeCityName('Bangalore')).toBe('bengaluru');
    expect(normalizeCityName('BLR')).toBe('bengaluru');
    expect(normalizeCityName('Bengaluru Urban')).toBe('bengaluru');
  });

  it('2. normalizes "Bombay", "Mumbai" to "mumbai" and "Madras", "Chennai" to "chennai"', () => {
    expect(normalizeCityName('Bombay')).toBe('mumbai');
    expect(normalizeCityName('Mumbai')).toBe('mumbai');
    expect(normalizeCityName('Madras')).toBe('chennai');
    expect(normalizeCityName('Chennai')).toBe('chennai');
  });

  it('3. generates city search terms including canonical name and aliases', () => {
    const terms = getCitySearchTerms('Bengaluru');
    expect(terms).toContain('bengaluru');
    expect(terms).toContain('bangalore');
    expect(terms).toContain('blr');
  });

  it('4. maps restaurant with city "Bengaluru" to non-sensitive public profile cleanly', () => {
    const mockRestaurant: Restaurant = {
      restaurantId: 'rest_bengaluru_01',
      name: 'South Indian Tiffin Room',
      legalName: 'South Indian Tiffin Room LLP',
      logoUrl: null,
      email: 'contact@tiffinroom.in',
      gstNumber: '29ABCDE1234F1Z5',
      phone: '+91 9876543210',
      address: '124 Prime Market Square, MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'India',
      currency: 'INR',
      currencySymbol: '₹',
      timezone: 'Asia/Kolkata',
      taxMode: 'exclusive',
      defaultTaxRate: 5,
      ownerId: 'owner_123',
      isActive: true,
      publicStatus: 'active',
      onlineOrderingEnabled: true,
      restaurantOperatingMode: 'full_service',
      restaurantCapabilities: { ...FULL_SERVICE_CAPABILITIES }
    };

    const publicProfile = toPublicRestaurantProfile(mockRestaurant);
    expect(publicProfile.restaurantId).toBe('rest_bengaluru_01');
    expect(publicProfile.name).toBe('South Indian Tiffin Room');
    expect(publicProfile.city).toBe('Bengaluru');
    expect(publicProfile.publicStatus).toBe('active');
    expect(publicProfile.onlineOrderingEnabled).toBe(true);
    // Ensure sensitive fields like ownerId are NOT present
    expect((publicProfile as any).ownerId).toBeUndefined();
  });
});
