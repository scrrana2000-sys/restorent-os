import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode
} from 'react';
import { CustomerLocation, RestaurantDiscoveryCriteria } from '../types/customer';
import {
  IndianCity,
  INDIAN_CITIES,
  resolveClosestCityFromCoordinates,
  findIndianCityByName
} from '../data/indianLocations';

export type LocationPermissionStatus =
  | 'idle'
  | 'requesting'
  | 'available'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'manual';

export interface CustomerLocationContextValue {
  /** Current active customer location */
  location: CustomerLocation | null;
  /** Browser geolocation / resolution status */
  status: LocationPermissionStatus;
  /** Descriptive error message if detection failed */
  errorMessage: string | null;
  /** Whether geolocation is currently being requested */
  isLoading: boolean;
  /** Whether location permission was explicitly denied by browser */
  isDenied: boolean;
  /** Whether the current location is determined manually */
  isManual: boolean;
  /** Request browser geolocation and attempt safe city resolution */
  requestLocation: () => Promise<CustomerLocation | null>;
  /** Set location manually by city, state, and optional area */
  setManualLocation: (city: string, state?: string, area?: string) => void;
  /** Set location by IndianCity data object with optional area */
  selectCity: (cityObj: IndianCity, area?: string) => void;
  /** Set location via resolved Indian 6-digit PIN code */
  setPincodeLocation: (city: string, state: string, area: string | undefined, postalCode: string) => void;
  /** Clears the current location and resets to idle */
  resetLocation: () => void;
  /** Prepares normalized discovery criteria for M9-B customerDiscoveryService */
  getDiscoveryCriteria: (additionalFilters?: Partial<RestaurantDiscoveryCriteria>) => RestaurantDiscoveryCriteria | null;
}

const STORAGE_KEY = 'restaurantos_customer_location_pref_v1';

/**
 * Validates and retrieves safe persisted manual location from localStorage.
 * Does NOT persist or read raw coordinates from storage to protect user privacy.
 */
function getStoredLocationPreference(): CustomerLocation | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.city === 'string' &&
      parsed.city.trim().length > 0
    ) {
      return {
        city: parsed.city.trim(),
        state: typeof parsed.state === 'string' ? parsed.state.trim() : undefined,
        area: typeof parsed.area === 'string' ? parsed.area.trim() : undefined,
        postalCode: typeof parsed.postalCode === 'string' ? parsed.postalCode.trim() : undefined,
        source: parsed.source === 'gps' ? 'gps' : parsed.source === 'pincode' ? 'pincode' : 'manual',
        isApproximate: true
      };
    }
  } catch {
    // Malformed storage ignored safely
  }
  return null;
}

/**
 * Persists safe city/state/area/postalCode preference without raw GPS coordinates.
 */
function storeLocationPreference(loc: CustomerLocation | null) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!loc || !loc.city) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      const safeData = {
        city: loc.city,
        state: loc.state,
        area: loc.area,
        postalCode: loc.postalCode,
        source: loc.source
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeData));
    }
  } catch {
    // Ignore storage errors safely
  }
}

const CustomerLocationContext = createContext<CustomerLocationContextValue | undefined>(undefined);

export interface CustomerLocationProviderProps {
  children: ReactNode;
  initialLocation?: CustomerLocation | null;
  /** Whether to auto-attempt location resolution on mount (defaults to true) */
  autoDetectOnMount?: boolean;
}

export const CustomerLocationProvider: React.FC<CustomerLocationProviderProps> = ({
  children,
  initialLocation,
  autoDetectOnMount = true
}) => {
  // Initialize state with initial prop or persisted manual preference
  const [location, setLocation] = useState<CustomerLocation | null>(() => {
    if (initialLocation !== undefined) return initialLocation;
    return getStoredLocationPreference();
  });

  const [status, setStatus] = useState<LocationPermissionStatus>(() => {
    if (initialLocation || getStoredLocationPreference()) {
      return 'available';
    }
    return 'idle';
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * Sets manual location with safe city/state/area and persists preference.
   */
  const setManualLocation = useCallback((city: string, state?: string, area?: string) => {
    const trimmedCity = city ? city.trim() : '';
    if (!trimmedCity) return;

    // Look up state if not provided
    let resolvedState = state?.trim();
    if (!resolvedState) {
      const matchedCity = findIndianCityByName(trimmedCity);
      if (matchedCity) {
        resolvedState = matchedCity.state;
      }
    }

    const newLoc: CustomerLocation = {
      city: trimmedCity,
      state: resolvedState || undefined,
      area: area?.trim() || undefined,
      source: 'manual',
      isApproximate: false
    };

    setLocation(newLoc);
    setStatus('available');
    setErrorMessage(null);
    storeLocationPreference(newLoc);
  }, []);

  /**
   * Selects location from predefined IndianCity object with optional area.
   */
  const selectCity = useCallback((cityObj: IndianCity, area?: string) => {
    if (!cityObj || !cityObj.name) return;
    const newLoc: CustomerLocation = {
      city: cityObj.name,
      state: cityObj.state,
      area: area?.trim() || undefined,
      source: 'city-selection',
      isApproximate: false
    };

    setLocation(newLoc);
    setStatus('available');
    setErrorMessage(null);
    storeLocationPreference(newLoc);
  }, []);

  /**
   * Selects location via resolved Indian 6-digit PIN code.
   */
  const setPincodeLocation = useCallback(
    (city: string, state: string, area: string | undefined, postalCode: string) => {
      const trimmedCity = city ? city.trim() : '';
      if (!trimmedCity) return;

      const newLoc: CustomerLocation = {
        city: trimmedCity,
        state: state?.trim() || undefined,
        area: area?.trim() || undefined,
        postalCode: postalCode?.trim() || undefined,
        source: 'pincode',
        isApproximate: false
      };

      setLocation(newLoc);
      setStatus('available');
      setErrorMessage(null);
      storeLocationPreference(newLoc);
    },
    []
  );

  /**
   * Clears location and removes persisted preference.
   */
  const resetLocation = useCallback(() => {
    setLocation(null);
    setStatus('idle');
    setErrorMessage(null);
    storeLocationPreference(null);
  }, []);

  /**
   * Requests browser geolocation and attempts to resolve to normalized Indian city.
   */
  const requestLocation = useCallback(async (): Promise<CustomerLocation | null> => {
    setStatus('requesting');
    setErrorMessage(null);

    if (typeof window === 'undefined' || !navigator || !navigator.geolocation) {
      setStatus('unavailable');
      setErrorMessage('Geolocation is not supported by your browser or environment.');
      return null;
    }

    return new Promise<CustomerLocation | null>((resolve) => {
      const options: PositionOptions = {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes cache
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          // Attempt safe city resolution without external paid API
          const closestCity = resolveClosestCityFromCoordinates(latitude, longitude);

          if (closestCity) {
            const detectedLocation: CustomerLocation = {
              city: closestCity.name,
              state: closestCity.state,
              area: undefined,
              latitude,
              longitude,
              source: 'gps',
              isApproximate: true
            };
            setLocation(detectedLocation);
            setStatus('available');
            setErrorMessage(null);
            // Persist safe city without raw coords
            storeLocationPreference(detectedLocation);
            resolve(detectedLocation);
          } else {
            // Coordinate found but not near known dataset cities; request manual selection
            setStatus('manual');
            setErrorMessage('Location detected, please confirm your nearest city.');
            resolve(null);
          }
        },
        (error: GeolocationPositionError) => {
          let errCode: LocationPermissionStatus = 'unavailable';
          let message = 'Unable to determine your location.';

          switch (error.code) {
            case error.PERMISSION_DENIED:
              errCode = 'denied';
              message = 'Location permission was denied. Please select your city manually.';
              break;
            case error.POSITION_UNAVAILABLE:
              errCode = 'unavailable';
              message = 'Location information is currently unavailable.';
              break;
            case error.TIMEOUT:
              errCode = 'timeout';
              message = 'Location request timed out. Please choose your city.';
              break;
          }

          setStatus(errCode);
          setErrorMessage(message);
          resolve(null);
        },
        options
      );
    });
  }, []);

  /**
   * Auto-detection on initial mount if no manual preference already exists.
   */
  useEffect(() => {
    if (!autoDetectOnMount) return;
    if (location) return; // Already has location or stored preference

    // Attempt location detection once on first visit if supported
    if (typeof window !== 'undefined' && navigator && navigator.geolocation) {
      // Non-blocking attempt
      requestLocation().catch(() => {});
    }
  }, [autoDetectOnMount, location, requestLocation]);

  /**
   * Generates normalized discovery criteria for M9-B discoverRestaurants().
   */
  const getDiscoveryCriteria = useCallback(
    (additionalFilters?: Partial<RestaurantDiscoveryCriteria>): RestaurantDiscoveryCriteria | null => {
      if (!location || !location.city) {
        return null;
      }

      return {
        city: location.city,
        state: location.state,
        area: location.area,
        postalCode: location.postalCode,
        ...additionalFilters
      };
    },
    [location]
  );

  const value = useMemo<CustomerLocationContextValue>(() => ({
    location,
    status,
    errorMessage,
    isLoading: status === 'requesting',
    isDenied: status === 'denied',
    isManual: location?.source === 'manual' || location?.source === 'city-selection' || location?.source === 'pincode',
    requestLocation,
    setManualLocation,
    selectCity,
    setPincodeLocation,
    resetLocation,
    getDiscoveryCriteria
  }), [
    location,
    status,
    errorMessage,
    requestLocation,
    setManualLocation,
    selectCity,
    setPincodeLocation,
    resetLocation,
    getDiscoveryCriteria
  ]);

  return (
    <CustomerLocationContext.Provider value={value}>
      {children}
    </CustomerLocationContext.Provider>
  );
};

export function useCustomerLocation(): CustomerLocationContextValue {
  const context = useContext(CustomerLocationContext);
  if (!context) {
    throw new Error('useCustomerLocation must be used within a CustomerLocationProvider');
  }
  return context;
}
