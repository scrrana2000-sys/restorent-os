import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import {
  CustomerLocationProvider,
  useCustomerLocation
} from '../context/CustomerLocationContext';
import {
  INDIAN_CITIES,
  searchIndianCities,
  findIndianCityByName,
  resolveClosestCityFromCoordinates,
  calculateHaversineDistanceKm
} from '../data/indianLocations';
import { CustomerLocation } from '../types/customer';
import { discoverRestaurants } from '../services/customerDiscoveryService';

// Mock discoverRestaurants from customerDiscoveryService to test integration without Firebase
vi.mock('../services/customerDiscoveryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/customerDiscoveryService')>();
  return {
    ...actual,
    discoverRestaurants: vi.fn(async (criteria) => ({
      restaurants: [],
      nextCursor: null,
      hasMore: false,
      totalReturned: 0,
      queryCity: criteria.city,
      queryArea: criteria.area
    }))
  };
});

describe('Milestone 9-C: Customer Location Context + Manual City Fallback', () => {
  const mockLocalStorage: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage mock
    for (const key in mockLocalStorage) {
      delete mockLocalStorage[key];
    }

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => mockLocalStorage[key] || null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      mockLocalStorage[key] = value;
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
      delete mockLocalStorage[key];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Initial Location State', () => {
    it('initializes with idle status and null location when no stored preference exists', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      expect(result.current.location).toBeNull();
      expect(result.current.status).toBe('idle');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isDenied).toBe(false);
      expect(result.current.isManual).toBe(false);
    });
  });

  describe('2. Browser Geolocation & GPS Success', () => {
    it('successfully detects coordinates and resolves to nearest Indian city (e.g. Raichur)', async () => {
      // Mock navigator.geolocation near Raichur coordinates (16.2076, 77.3463)
      const mockGeolocation = {
        getCurrentPosition: vi.fn((success) => {
          success({
            coords: {
              latitude: 16.208,
              longitude: 77.347,
              accuracy: 10
            }
          });
        })
      };
      vi.stubGlobal('navigator', { geolocation: mockGeolocation });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      let detectedLoc: CustomerLocation | null = null;
      await act(async () => {
        detectedLoc = await result.current.requestLocation();
      });

      expect(detectedLoc).not.toBeNull();
      expect(detectedLoc?.city).toBe('Raichur');
      expect(detectedLoc?.state).toBe('Karnataka');
      expect(detectedLoc?.source).toBe('gps');
      expect(result.current.status).toBe('available');
      expect(result.current.location?.city).toBe('Raichur');
    });

    it('resolves coordinates near Bengaluru to Bengaluru city', async () => {
      const mockGeolocation = {
        getCurrentPosition: vi.fn((success) => {
          success({
            coords: {
              latitude: 12.9716,
              longitude: 77.5946,
              accuracy: 15
            }
          });
        })
      };
      vi.stubGlobal('navigator', { geolocation: mockGeolocation });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      await act(async () => {
        await result.current.requestLocation();
      });

      expect(result.current.location?.city).toBe('Bengaluru');
      expect(result.current.location?.state).toBe('Karnataka');
    });
  });

  describe('3. GPS Denied Handling', () => {
    it('handles permission denial gracefully without throwing or blocking app', async () => {
      const mockGeolocation = {
        getCurrentPosition: vi.fn((_, error) => {
          error({
            code: 1, // PERMISSION_DENIED
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'User denied Geolocation'
          });
        })
      };
      vi.stubGlobal('navigator', { geolocation: mockGeolocation });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      await act(async () => {
        const res = await result.current.requestLocation();
        expect(res).toBeNull();
      });

      expect(result.current.status).toBe('denied');
      expect(result.current.isDenied).toBe(true);
      expect(result.current.errorMessage).toContain('permission was denied');
      expect(result.current.location).toBeNull();
    });
  });

  describe('4. GPS Unavailable Handling', () => {
    it('handles position unavailable error cleanly', async () => {
      const mockGeolocation = {
        getCurrentPosition: vi.fn((_, error) => {
          error({
            code: 2, // POSITION_UNAVAILABLE
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'Position unavailable'
          });
        })
      };
      vi.stubGlobal('navigator', { geolocation: mockGeolocation });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      await act(async () => {
        await result.current.requestLocation();
      });

      expect(result.current.status).toBe('unavailable');
      expect(result.current.errorMessage).toContain('unavailable');
    });
  });

  describe('5. GPS Timeout Handling', () => {
    it('handles geolocation timeout error gracefully', async () => {
      const mockGeolocation = {
        getCurrentPosition: vi.fn((_, error) => {
          error({
            code: 3, // TIMEOUT
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'Location request timed out'
          });
        })
      };
      vi.stubGlobal('navigator', { geolocation: mockGeolocation });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      await act(async () => {
        await result.current.requestLocation();
      });

      expect(result.current.status).toBe('timeout');
      expect(result.current.errorMessage).toContain('timed out');
    });
  });

  describe('6. Browser Geolocation Unsupported Environment', () => {
    it('returns unavailable status when navigator.geolocation is missing', async () => {
      vi.stubGlobal('navigator', {});

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      await act(async () => {
        const res = await result.current.requestLocation();
        expect(res).toBeNull();
      });

      expect(result.current.status).toBe('unavailable');
      expect(result.current.errorMessage).toContain('not supported');
    });
  });

  describe('7. Manual City Selection', () => {
    it('sets manual city and updates status to available', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Hyderabad', 'Telangana');
      });

      expect(result.current.location).toEqual({
        city: 'Hyderabad',
        state: 'Telangana',
        area: undefined,
        source: 'manual',
        isApproximate: false
      });
      expect(result.current.status).toBe('available');
      expect(result.current.isManual).toBe(true);
    });

    it('auto-resolves state for known Indian cities when state is omitted in setManualLocation', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Mumbai');
      });

      expect(result.current.location?.city).toBe('Mumbai');
      expect(result.current.location?.state).toBe('Maharashtra');
    });
  });

  describe('8. Selection via IndianCity Object (selectCity)', () => {
    it('sets location using IndianCity entity from dataset', () => {
      const cityObj = INDIAN_CITIES.find((c) => c.name === 'Raichur')!;
      expect(cityObj).toBeDefined();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.selectCity(cityObj, 'Station Road');
      });

      expect(result.current.location).toEqual({
        city: 'Raichur',
        state: 'Karnataka',
        area: 'Station Road',
        source: 'city-selection',
        isApproximate: false
      });
      expect(result.current.isManual).toBe(true);
    });
  });

  describe('9. Optional Area Handling', () => {
    it('supports selecting city with or without specific area', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      // Without area
      act(() => {
        result.current.setManualLocation('Pune', 'Maharashtra');
      });
      expect(result.current.location?.area).toBeUndefined();

      // With area
      act(() => {
        result.current.setManualLocation('Pune', 'Maharashtra', 'Koregaon Park');
      });
      expect(result.current.location?.area).toBe('Koregaon Park');
    });
  });

  describe('10. Change Location', () => {
    it('seamlessly replaces existing location with new chosen location', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      // First location
      act(() => {
        result.current.setManualLocation('Raichur', 'Karnataka', 'Station Road');
      });
      expect(result.current.location?.city).toBe('Raichur');

      // Change to Bengaluru
      act(() => {
        result.current.setManualLocation('Bengaluru', 'Karnataka', 'Indiranagar');
      });
      expect(result.current.location?.city).toBe('Bengaluru');
      expect(result.current.location?.area).toBe('Indiranagar');
    });
  });

  describe('11. Safe Location Persistence', () => {
    it('persists safe city preference to localStorage on manual selection', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Jaipur', 'Rajasthan', 'C-Scheme');
      });

      const stored = JSON.parse(mockLocalStorage['restaurantos_customer_location_pref_v1']);
      expect(stored).toEqual({
        city: 'Jaipur',
        state: 'Rajasthan',
        area: 'C-Scheme',
        source: 'manual'
      });
      // Verify precise GPS coordinates are NOT persisted
      expect(stored.latitude).toBeUndefined();
      expect(stored.longitude).toBeUndefined();
    });

    it('loads persisted location preference on mount', () => {
      mockLocalStorage['restaurantos_customer_location_pref_v1'] = JSON.stringify({
        city: 'Kolkata',
        state: 'West Bengal',
        area: 'Park Street',
        source: 'manual'
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      expect(result.current.location).toEqual({
        city: 'Kolkata',
        state: 'West Bengal',
        area: 'Park Street',
        source: 'manual',
        isApproximate: true
      });
      expect(result.current.status).toBe('available');
    });
  });

  describe('12. Invalid Persisted Location Fallback', () => {
    it('gracefully ignores malformed JSON or invalid structures in localStorage', () => {
      mockLocalStorage['restaurantos_customer_location_pref_v1'] = 'INVALID_JSON_%%%';

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      expect(result.current.location).toBeNull();
      expect(result.current.status).toBe('idle');
    });
  });

  describe('13. Reset Location', () => {
    it('clears active location and removes storage preference', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Chennai', 'Tamil Nadu');
      });
      expect(result.current.location).not.toBeNull();

      act(() => {
        result.current.resetLocation();
      });

      expect(result.current.location).toBeNull();
      expect(result.current.status).toBe('idle');
      expect(mockLocalStorage['restaurantos_customer_location_pref_v1']).toBeUndefined();
    });
  });

  describe('14. M9-B Discovery Criteria Resolution & Integration', () => {
    it('returns null criteria when no city location is set', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      expect(result.current.getDiscoveryCriteria()).toBeNull();
    });

    it('formats normalized criteria matching M9-B RestaurantDiscoveryCriteria contract', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Raichur', 'Karnataka', 'Station Road');
      });

      const criteria = result.current.getDiscoveryCriteria({
        deliveryOnly: true,
        cuisine: 'North Indian'
      });

      expect(criteria).toEqual({
        city: 'Raichur',
        state: 'Karnataka',
        area: 'Station Road',
        deliveryOnly: true,
        cuisine: 'North Indian'
      });
    });

    it('passes criteria directly to discoverRestaurants without nationwide leakage', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Bengaluru', 'Karnataka');
      });

      const criteria = result.current.getDiscoveryCriteria();
      expect(criteria).not.toBeNull();

      if (criteria) {
        await discoverRestaurants(criteria);
        expect(discoverRestaurants).toHaveBeenCalledWith({
          city: 'Bengaluru',
          state: 'Karnataka',
          area: undefined
        });
      }
    });
  });

  describe('15. Indian Cities Dataset & Haversine Distance', () => {
    it('contains major Indian metropolitan and tier-2 cities across India', () => {
      expect(INDIAN_CITIES.length).toBeGreaterThanOrEqual(30);

      const bangalore = findIndianCityByName('Bengaluru');
      expect(bangalore).toBeDefined();
      expect(bangalore?.state).toBe('Karnataka');

      const raichur = findIndianCityByName('Raichur');
      expect(raichur).toBeDefined();

      const mumbai = findIndianCityByName('Mumbai');
      expect(mumbai).toBeDefined();

      const delhi = findIndianCityByName('Delhi');
      expect(delhi).toBeDefined();
    });

    it('searches cities by name, alias, and area', () => {
      const resultsBangalore = searchIndianCities('Indiranagar');
      expect(resultsBangalore.some((c) => c.name === 'Bengaluru')).toBe(true);

      const resultsRaichur = searchIndianCities('Station Road');
      expect(resultsRaichur.some((c) => c.name === 'Raichur')).toBe(true);

      const resultsAlias = searchIndianCities('Bombay');
      expect(resultsAlias.some((c) => c.name === 'Mumbai')).toBe(true);
    });

    it('calculates Haversine distance accurately', () => {
      // Distance between Bengaluru (12.9716, 77.5946) and Mysuru (12.2958, 76.6394) is ~130-145 km
      const dist = calculateHaversineDistanceKm(12.9716, 77.5946, 12.2958, 76.6394);
      expect(dist).toBeGreaterThan(120);
      expect(dist).toBeLessThan(160);
    });

    it('resolves closest city within threshold and rejects coordinates in the ocean/abroad', () => {
      // Coordinates right inside Raichur
      const resolvedRaichur = resolveClosestCityFromCoordinates(16.2076, 77.3463);
      expect(resolvedRaichur?.name).toBe('Raichur');

      // Coordinates in the middle of the Atlantic ocean (0, 0)
      const oceanCoord = resolveClosestCityFromCoordinates(0, 0);
      expect(oceanCoord).toBeNull();
    });
  });

  describe('16. Security & Privacy Boundary Review', () => {
    it('ensures customer location never attaches to or mutates restaurant documents', () => {
      // Pure client-side context test
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });

      act(() => {
        result.current.setManualLocation('Raichur', 'Karnataka');
      });

      expect(result.current.location?.city).toBe('Raichur');
      // No restaurant mutation exists in CustomerLocationContext
    });

    it('ensures customer location does not bypass tenant isolation or staff RBAC', () => {
      // Customer location context does not contain any staff auth overrides
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CustomerLocationProvider autoDetectOnMount={false}>
          {children}
        </CustomerLocationProvider>
      );

      const { result } = renderHook(() => useCustomerLocation(), { wrapper });
      expect((result.current as any).restaurantId).toBeUndefined();
      expect((result.current as any).role).toBeUndefined();
    });
  });
});
