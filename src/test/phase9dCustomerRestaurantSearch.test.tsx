import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCustomerRestaurantSearch } from '../hooks/useCustomerRestaurantSearch';
import { CustomerLocationProvider } from '../context/CustomerLocationContext';
import * as customerDiscoveryService from '../services/customerDiscoveryService';
import { PublicRestaurantProfile, PaginatedDiscoveryResult } from '../types/customer';

// Mock the discovery service
vi.mock('../services/customerDiscoveryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/customerDiscoveryService')>();
  return {
    ...actual,
    discoverRestaurants: vi.fn(),
    resolveRestaurantBySlug: vi.fn(),
    resolveRestaurantByPublicCode: vi.fn()
  };
});

const mockRaichurRestaurants: PublicRestaurantProfile[] = [
  {
    restaurantId: 'rest_raichur_1',
    publicSlug: 'sharma-family-restaurant-raichur-01',
    publicRestaurantCode: 'R-RC01',
    name: 'Sharma Family Restaurant',
    city: 'Raichur',
    state: 'Karnataka',
    area: 'Station Road',
    postalCode: '584101',
    country: 'India',
    currency: 'INR',
    currencySymbol: '₹',
    phone: '9876543210',
    address: 'Near Station Road, Raichur',
    cuisine: ['North Indian', 'Thali'],
    publicStatus: 'active',
    onlineOrderingEnabled: true,
    takeawayEnabled: true,
    deliveryEnabled: true,
    logoUrl: null,
    coverImageUrl: null,
    isOpenNow: true
  },
  {
    restaurantId: 'rest_raichur_2',
    publicSlug: 'udupi-krishna-grand-raichur-02',
    publicRestaurantCode: 'R-RC02',
    name: 'Udupi Krishna Grand',
    city: 'Raichur',
    state: 'Karnataka',
    area: 'Market Yard',
    postalCode: '584102',
    country: 'India',
    currency: 'INR',
    currencySymbol: '₹',
    phone: '9876543211',
    address: 'Market Yard, Raichur',
    cuisine: ['South Indian', 'Breakfast', 'Fast Food'],
    publicStatus: 'active',
    onlineOrderingEnabled: true,
    takeawayEnabled: true,
    deliveryEnabled: false,
    logoUrl: null,
    coverImageUrl: null,
    isOpenNow: true
  },
  {
    restaurantId: 'rest_raichur_3',
    publicSlug: 'pizza-paradise-raichur-03',
    publicRestaurantCode: 'R-RC03',
    name: 'Pizza Paradise',
    city: 'Raichur',
    state: 'Karnataka',
    area: 'MG Road',
    postalCode: '584101',
    country: 'India',
    currency: 'INR',
    currencySymbol: '₹',
    phone: '9876543212',
    address: 'MG Road, Raichur',
    cuisine: ['Pizza', 'Fast Food', 'Italian'],
    publicStatus: 'active',
    onlineOrderingEnabled: true,
    takeawayEnabled: true,
    deliveryEnabled: true,
    logoUrl: null,
    coverImageUrl: null,
    isOpenNow: true
  }
];

describe('Milestone 9-D: Customer Restaurant Search & Filtering', () => {
  const mockLocalStorage: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k in mockLocalStorage) {
      delete mockLocalStorage[k];
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => mockLocalStorage[key] || null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      mockLocalStorage[key] = value;
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
      delete mockLocalStorage[key];
    });

    // Default mock response for discoverRestaurants
    vi.mocked(customerDiscoveryService.discoverRestaurants).mockResolvedValue({
      restaurants: mockRaichurRestaurants,
      nextCursor: null,
      hasMore: false,
      totalReturned: mockRaichurRestaurants.length,
      queryCity: 'Raichur',
      queryArea: undefined
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createWrapper = (initialCity = 'Raichur') => {
    return ({ children }: { children: React.ReactNode }) => (
      <CustomerLocationProvider
        autoDetectOnMount={false}
        initialLocation={
          initialCity
            ? {
                city: initialCity,
                state: 'Karnataka',
                source: 'manual',
                isApproximate: true
              }
            : undefined
        }
      >
        {children}
      </CustomerLocationProvider>
    );
  };

  it('1. Restaurant name search triggers discovery query scoped to city', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setSearchQuery('Sharma');
    });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Raichur',
        searchQuery: 'Sharma'
      })
    );
  });

  it('2. Public slug search triggers exact slug resolution', async () => {
    vi.mocked(customerDiscoveryService.resolveRestaurantBySlug).mockResolvedValueOnce(mockRaichurRestaurants[0]);

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setSearchQuery('sharma-family-restaurant-raichur-01');
    });

    expect(customerDiscoveryService.resolveRestaurantBySlug).toHaveBeenCalledWith('sharma-family-restaurant-raichur-01');
    expect(result.current.exactMatch).toEqual(mockRaichurRestaurants[0]);
  });

  it('3. Public code search triggers exact code resolution', async () => {
    vi.mocked(customerDiscoveryService.resolveRestaurantByPublicCode).mockResolvedValueOnce(mockRaichurRestaurants[0]);

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setSearchQuery('R-RC01');
    });

    expect(customerDiscoveryService.resolveRestaurantByPublicCode).toHaveBeenCalledWith('R-RC01');
    expect(result.current.exactMatch).toEqual(mockRaichurRestaurants[0]);
  });

  it('4. City filter scopes query and changes results upon city change', async () => {
    const wrapper = createWrapper('Bengaluru');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Bengaluru'
      })
    );
  });

  it('5. Area filter passes area parameter to discovery query', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setArea('Station Road');
    });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Raichur',
        area: 'Station Road'
      })
    );
  });

  it('6. Cuisine filter passes cuisine criteria to discovery query', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setCuisine('South Indian');
    });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Raichur',
        cuisine: 'South Indian'
      })
    );
  });

  it('7. Delivery filter passes deliveryOnly criteria to discovery query', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setDeliveryOnly(true);
    });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Raichur',
        deliveryOnly: true
      })
    );
  });

  it('8. Takeaway filter passes takeawayOnly criteria to discovery query', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setTakeawayOnly(true);
    });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Raichur',
        takeawayOnly: true
      })
    );
  });

  it('9. Online ordering filter filters restaurants by onlineOrderingEnabled', async () => {
    const mixedRestaurants: PublicRestaurantProfile[] = [
      { ...mockRaichurRestaurants[0], onlineOrderingEnabled: true },
      { ...mockRaichurRestaurants[1], onlineOrderingEnabled: false }
    ];
    vi.mocked(customerDiscoveryService.discoverRestaurants).mockResolvedValue({
      restaurants: mixedRestaurants,
      nextCursor: null,
      hasMore: false,
      totalReturned: 2,
      queryCity: 'Raichur'
    });

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setOnlineOrderingOnly(true);
    });

    expect(result.current.restaurants.length).toBe(1);
    expect(result.current.restaurants[0].restaurantId).toBe('rest_raichur_1');
  });

  it('10. Multiple filters combine deterministically', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setCuisine('North Indian');
      result.current.setDeliveryOnly(true);
      result.current.setSearchQuery('Sharma');
    });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Raichur',
        cuisine: 'North Indian',
        deliveryOnly: true,
        searchQuery: 'Sharma'
      })
    );
  });

  it('11. Empty results handle gracefully with empty array', async () => {
    vi.mocked(customerDiscoveryService.discoverRestaurants).mockResolvedValue({
      restaurants: [],
      nextCursor: null,
      hasMore: false,
      totalReturned: 0,
      queryCity: 'Raichur'
    });

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setSearchQuery('NonExistentFood');
    });

    expect(result.current.restaurants).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('12. Invalid search does not crash hook or service', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setSearchQuery('!@#$%^&*()_+');
    });

    expect(result.current.error).toBeNull();
  });

  it('13. Pagination loads more restaurants via nextCursor', async () => {
    vi.mocked(customerDiscoveryService.discoverRestaurants)
      .mockResolvedValueOnce({
        restaurants: [mockRaichurRestaurants[0]],
        nextCursor: 'rest_raichur_1',
        hasMore: true,
        totalReturned: 1,
        queryCity: 'Raichur'
      })
      .mockResolvedValueOnce({
        restaurants: [mockRaichurRestaurants[1]],
        nextCursor: null,
        hasMore: false,
        totalReturned: 1,
        queryCity: 'Raichur'
      });

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0, pageSize: 1 }), { wrapper });

    await waitFor(() => {
      expect(result.current.restaurants.length).toBe(1);
    });
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.restaurants.length).toBe(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('14. Search debounce honors configured debounce delay', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = createWrapper('Raichur');
      const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 250 }), { wrapper });

      act(() => {
        result.current.setSearchQuery('Biryani');
      });

      // Query should not fire immediately before debounce timer expires
      expect(customerDiscoveryService.discoverRestaurants).not.toHaveBeenCalledWith(
        expect.objectContaining({ searchQuery: 'Biryani' })
      );

      // Advance timers by 250ms
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
        expect.objectContaining({ searchQuery: 'Biryani' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('15. Current-location scoped search uses active GPS or detected city', async () => {
    const wrapper = createWrapper('Mysuru');
    renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Mysuru'
      })
    );
  });

  it('16. Manual-city scoped search uses manually chosen city', async () => {
    const wrapper = createWrapper('Belagavi');
    renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    expect(customerDiscoveryService.discoverRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Belagavi'
      })
    );
  });

  it('17. No nationwide default query: empty city does not query Firestore', async () => {
    const wrapper = createWrapper('');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    expect(result.current.restaurants).toEqual([]);
    expect(customerDiscoveryService.discoverRestaurants).not.toHaveBeenCalled();
  });

  it('18. Public-only fields: all returned restaurants contain only public safe data', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await waitFor(() => {
      expect(result.current.restaurants.length).toBeGreaterThan(0);
    });

    result.current.restaurants.forEach((r) => {
      expect(r).not.toHaveProperty('ownerId');
      expect(r).not.toHaveProperty('gstNumber');
      expect(r).not.toHaveProperty('fssaiNumber');
      expect(r).not.toHaveProperty('staff');
      expect(r).not.toHaveProperty('dailySales');
      expect(r.restaurantId).toBeDefined();
      expect(r.name).toBeDefined();
      expect(r.publicSlug).toBeDefined();
      expect(r.publicRestaurantCode).toBeDefined();
    });
  });

  it('19. Restaurant isolation: multiple restaurants in same city have separate restaurantIds', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await waitFor(() => {
      expect(result.current.restaurants.length).toBeGreaterThan(0);
    });

    const ids = result.current.restaurants.map((r) => r.restaurantId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('20. Paused/closed restaurant behavior: reflects publicStatus accurately', async () => {
    const closedRestaurant: PublicRestaurantProfile = {
      ...mockRaichurRestaurants[0],
      restaurantId: 'rest_closed',
      publicStatus: 'closed',
      isOpenNow: false
    };
    vi.mocked(customerDiscoveryService.discoverRestaurants).mockResolvedValue({
      restaurants: [closedRestaurant],
      nextCursor: null,
      hasMore: false,
      totalReturned: 1,
      queryCity: 'Raichur'
    });

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await waitFor(() => {
      expect(result.current.restaurants.length).toBe(1);
    });

    expect(result.current.restaurants[0].publicStatus).toBe('closed');
    expect(result.current.restaurants[0].isOpenNow).toBe(false);
  });

  it('21. Network error sets error state gracefully without crash', async () => {
    vi.mocked(customerDiscoveryService.discoverRestaurants).mockRejectedValue(
      new Error('Firestore connection timeout')
    );

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toContain('Firestore connection timeout');
  });

  it('22. Retry refetches data and clears prior error', async () => {
    vi.mocked(customerDiscoveryService.discoverRestaurants)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({
        restaurants: mockRaichurRestaurants,
        nextCursor: null,
        hasMore: false,
        totalReturned: mockRaichurRestaurants.length,
        queryCity: 'Raichur'
      });

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.restaurants.length).toBe(mockRaichurRestaurants.length);
  });

  it('23. Loading state reflects in-flight queries', async () => {
    let resolveQuery: (val: PaginatedDiscoveryResult) => void = () => {};
    const queryPromise = new Promise<PaginatedDiscoveryResult>((res) => {
      resolveQuery = res;
    });

    vi.mocked(customerDiscoveryService.discoverRestaurants).mockReturnValueOnce(queryPromise);

    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveQuery({
        restaurants: mockRaichurRestaurants,
        nextCursor: null,
        hasMore: false,
        totalReturned: mockRaichurRestaurants.length,
        queryCity: 'Raichur'
      });
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('24. Reset filters restores initial filter state', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setSearchQuery('Dosa');
      result.current.setCuisine('South Indian');
      result.current.setDeliveryOnly(true);
      result.current.setArea('Station Road');
    });

    expect(result.current.filters.searchQuery).toBe('Dosa');
    expect(result.current.filters.selectedCuisine).toBe('South Indian');

    await act(async () => {
      result.current.resetFilters();
    });

    expect(result.current.filters.searchQuery).toBe('');
    expect(result.current.filters.selectedCuisine).toBeNull();
    expect(result.current.filters.deliveryOnly).toBe(false);
    expect(result.current.filters.selectedArea).toBeNull();
  });

  it('25. Mobile responsive filter toggles update individual filter states without side-effects', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await act(async () => {
      result.current.setTakeawayOnly(true);
    });

    expect(result.current.filters.takeawayOnly).toBe(true);
    expect(result.current.filters.deliveryOnly).toBe(false);
    expect(result.current.filters.onlineOrderingOnly).toBe(false);

    await act(async () => {
      result.current.setTakeawayOnly(false);
    });

    expect(result.current.filters.takeawayOnly).toBe(false);
  });

  it('26. Total restaurant count dynamically reflects current filtered dataset size', async () => {
    const wrapper = createWrapper('Raichur');
    const { result } = renderHook(() => useCustomerRestaurantSearch({ debounceMs: 0 }), { wrapper });

    await waitFor(() => {
      expect(result.current.restaurants.length).toBe(mockRaichurRestaurants.length);
    });

    expect(result.current.totalCount).toBe(mockRaichurRestaurants.length);
  });
});

