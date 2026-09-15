import { useState, useEffect, useCallback, useRef } from 'react';
import { useCustomerLocation } from '../context/CustomerLocationContext';
import {
  PublicRestaurantProfile,
  CustomerRestaurantFilterState,
  RestaurantDiscoveryCriteria
} from '../types/customer';
import {
  discoverRestaurants,
  resolveRestaurantBySlug,
  resolveRestaurantByPublicCode
} from '../services/customerDiscoveryService';

export interface UseCustomerRestaurantSearchOptions {
  debounceMs?: number;
  pageSize?: number;
  autoFetch?: boolean;
}

export interface UseCustomerRestaurantSearchResult {
  restaurants: PublicRestaurantProfile[];
  exactMatch: PublicRestaurantProfile | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  filters: CustomerRestaurantFilterState;
  setSearchQuery: (query: string) => void;
  setCuisine: (cuisine: string | null) => void;
  setArea: (area: string | null) => void;
  setDeliveryOnly: (enabled: boolean) => void;
  setTakeawayOnly: (enabled: boolean) => void;
  setOnlineOrderingOnly: (enabled: boolean) => void;
  resetFilters: () => void;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  totalCount: number;
}

const DEFAULT_FILTERS: CustomerRestaurantFilterState = {
  searchQuery: '',
  selectedCuisine: null,
  deliveryOnly: false,
  takeawayOnly: false,
  onlineOrderingOnly: false,
  selectedArea: null
};

/**
 * Custom Hook for Customer Restaurant Search, Filtering, Exact Resolution, and Cursor-based Pagination.
 * Integrates directly with CustomerLocationContext (M9-C) and customerDiscoveryService (M9-B).
 */
export function useCustomerRestaurantSearch(
  options: UseCustomerRestaurantSearchOptions = {}
): UseCustomerRestaurantSearchResult {
  const { debounceMs = 300, pageSize = 12, autoFetch = true } = options;
  const { location } = useCustomerLocation();

  const [filters, setFilters] = useState<CustomerRestaurantFilterState>(DEFAULT_FILTERS);
  const [debouncedQuery, setDebouncedQuery] = useState(filters.searchQuery);
  const [restaurants, setRestaurants] = useState<PublicRestaurantProfile[]>([]);
  const [exactMatch, setExactMatch] = useState<PublicRestaurantProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const nextCursorRef = useRef<string | null>(null);

  // Keep nextCursorRef in sync with nextCursor state
  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  // Track the current active request ID to avoid race conditions with out-of-order responses
  const activeRequestIdRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce the search query
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (debounceMs <= 0) {
      setDebouncedQuery(filters.searchQuery);
    } else {
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedQuery(filters.searchQuery);
      }, debounceMs);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filters.searchQuery, debounceMs]);

  // Execute Search / Discovery Query
  const fetchRestaurants = useCallback(
    async (isPageLoadMore = false) => {
      const currentCity = location?.city ? location.city.trim() : '';

      // If location is not set or city is empty, reset state without issuing queries
      if (!currentCity) {
        setRestaurants([]);
        setExactMatch(null);
        setHasMore(false);
        setNextCursor(null);
        nextCursorRef.current = null;
        setIsLoading(false);
        setIsLoadingMore(false);
        setError(null);
        return;
      }

      const requestId = ++activeRequestIdRef.current;

      if (isPageLoadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const trimmedQuery = debouncedQuery.trim();

        // 1. Check for Exact Identifier match (public code or exact slug pattern)
        let exactResolved: PublicRestaurantProfile | null = null;
        const isLikelyPublicCode = /^R-[A-Z0-9]+$/i.test(trimmedQuery) || /^ROS-[A-Z0-9]+$/i.test(trimmedQuery);
        const isLikelySlug = /^[a-z0-9]+(-[a-z0-9]+){2,}$/i.test(trimmedQuery);

        if (isLikelyPublicCode) {
          exactResolved = await resolveRestaurantByPublicCode(trimmedQuery);
        } else if (isLikelySlug) {
          exactResolved = await resolveRestaurantBySlug(trimmedQuery);
        }

        // 2. Query scoped to city using authoritative M9-B discovery service
        const criteria: RestaurantDiscoveryCriteria = {
          city: currentCity,
          state: location?.state,
          area: filters.selectedArea || (location?.area ? location.area : undefined),
          searchQuery: trimmedQuery || undefined,
          cuisine: filters.selectedCuisine || undefined,
          deliveryOnly: filters.deliveryOnly || undefined,
          takeawayOnly: filters.takeawayOnly || undefined,
          limit: pageSize,
          cursor: isPageLoadMore ? (nextCursorRef.current || undefined) : undefined
        };

        const result = await discoverRestaurants(criteria);

        // Discard stale response if a newer query has fired
        if (requestId !== activeRequestIdRef.current) {
          return;
        }

        let fetchedList = result.restaurants;

        // Apply onlineOrderingOnly filter if set
        if (filters.onlineOrderingOnly) {
          fetchedList = fetchedList.filter((r) => r.onlineOrderingEnabled);
        }

        if (isPageLoadMore) {
          setRestaurants((prev) => {
            // Deduplicate by restaurantId
            const existingIds = new Set(prev.map((r) => r.restaurantId));
            const fresh = fetchedList.filter((r) => !existingIds.has(r.restaurantId));
            return [...prev, ...fresh];
          });
        } else {
          setRestaurants(fetchedList);
        }

        setExactMatch(exactResolved);
        setHasMore(result.hasMore);
        setNextCursor(result.nextCursor);
        nextCursorRef.current = result.nextCursor;
        setError(null);
      } catch (err: any) {
        if (requestId === activeRequestIdRef.current) {
          console.warn('[RestaurantOS] Customer Search error:', err);
          setError(err?.message || 'Failed to search restaurants. Please check your connection.');
        }
      } finally {
        if (requestId === activeRequestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [
      location?.city,
      location?.state,
      location?.area,
      debouncedQuery,
      filters.selectedCuisine,
      filters.selectedArea,
      filters.deliveryOnly,
      filters.takeawayOnly,
      filters.onlineOrderingOnly,
      pageSize
    ]
  );

  // Trigger search when location, debouncedQuery, or active filters change
  useEffect(() => {
    if (!autoFetch) return;
    setNextCursor(null);
    nextCursorRef.current = null;
    fetchRestaurants(false);
  }, [
    autoFetch,
    location?.city,
    location?.area,
    debouncedQuery,
    filters.selectedCuisine,
    filters.selectedArea,
    filters.deliveryOnly,
    filters.takeawayOnly,
    filters.onlineOrderingOnly
  ]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore || !nextCursorRef.current) return;
    await fetchRestaurants(true);
  }, [hasMore, isLoading, isLoadingMore, fetchRestaurants]);

  const refetch = useCallback(async () => {
    setNextCursor(null);
    nextCursorRef.current = null;
    await fetchRestaurants(false);
  }, [fetchRestaurants]);

  const setSearchQuery = useCallback((query: string) => {
    setFilters((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setCuisine = useCallback((cuisine: string | null) => {
    setFilters((prev) => ({
      ...prev,
      selectedCuisine: prev.selectedCuisine === cuisine ? null : cuisine
    }));
  }, []);

  const setArea = useCallback((area: string | null) => {
    setFilters((prev) => ({ ...prev, selectedArea: area }));
  }, []);

  const setDeliveryOnly = useCallback((enabled: boolean) => {
    setFilters((prev) => ({ ...prev, deliveryOnly: enabled }));
  }, []);

  const setTakeawayOnly = useCallback((enabled: boolean) => {
    setFilters((prev) => ({ ...prev, takeawayOnly: enabled }));
  }, []);

  const setOnlineOrderingOnly = useCallback((enabled: boolean) => {
    setFilters((prev) => ({ ...prev, onlineOrderingOnly: enabled }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  return {
    restaurants,
    exactMatch,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    filters,
    setSearchQuery,
    setCuisine,
    setArea,
    setDeliveryOnly,
    setTakeawayOnly,
    setOnlineOrderingOnly,
    resetFilters,
    loadMore,
    refetch,
    totalCount: restaurants.length
  };
}
