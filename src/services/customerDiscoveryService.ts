import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  limit as firestoreLimit,
  startAfter,
  orderBy
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  PublicRestaurantProfile,
  RestaurantDiscoveryCriteria,
  PaginatedDiscoveryResult
} from '../types/customer';
import { Restaurant } from '../types/restaurant';
import {
  slugifyText,
  generatePublicRestaurantCode,
  generateDeterministicRestaurantSlug,
  toPublicRestaurantProfile
} from '../utils/publicRestaurantIdentity';
import { normalizeCityName, getCitySearchTerms } from '../utils/cityNormalization';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 30;

/**
 * Normalizes a city or area name for consistent matching.
 */
export function normalizeLocationTerm(term: string | undefined): string {
  return normalizeCityName(term);
}

/**
 * Synchronizes a restaurant's public discovery profile to the `publicRestaurants` collection.
 * This runs when a restaurant is created or updated by an owner/manager, ensuring public discovery
 * is always fast, indexable, and never touches private `restaurants/{restaurantId}` documents.
 */
export async function syncPublicRestaurantProfile(restaurant: Restaurant): Promise<PublicRestaurantProfile> {
  if (!restaurant || !restaurant.restaurantId) {
    throw new Error('Valid restaurant object with restaurantId is required for public sync');
  }

  const publicProfile = toPublicRestaurantProfile(restaurant);
  const publicDocRef = doc(db, 'publicRestaurants', restaurant.restaurantId);

  const normalizedCity = normalizeCityName(publicProfile.city);
  const normalizedArea = (publicProfile.area || '').trim().toLowerCase();

  const payload: Record<string, any> = {
    restaurantId: publicProfile.restaurantId,
    publicSlug: publicProfile.publicSlug,
    publicRestaurantCode: publicProfile.publicRestaurantCode,
    name: publicProfile.name,
    legalName: publicProfile.legalName || null,
    logoUrl: publicProfile.logoUrl || null,
    bannerImageUrl: publicProfile.bannerImageUrl || publicProfile.coverImageUrl || null,
    coverImageUrl: publicProfile.coverImageUrl || publicProfile.bannerImageUrl || null,
    phone: publicProfile.phone,
    address: publicProfile.address,
    city: publicProfile.city,
    cityLower: normalizedCity,
    state: publicProfile.state,
    area: publicProfile.area,
    areaLower: normalizedArea,
    postalCode: publicProfile.postalCode,
    country: publicProfile.country,
    currency: publicProfile.currency,
    currencySymbol: publicProfile.currencySymbol,
    cuisine: publicProfile.cuisine,
    publicStatus: publicProfile.publicStatus,
    onlineOrderingEnabled: publicProfile.onlineOrderingEnabled,
    takeawayEnabled: publicProfile.takeawayEnabled,
    deliveryEnabled: publicProfile.deliveryEnabled,
    isOpenNow: publicProfile.isOpenNow ?? true,
    updatedAt: new Date().toISOString()
  };

  await setDoc(publicDocRef, payload, { merge: true });
  return publicProfile;
}

/**
 * Discovers restaurants in a specific city with optional area, cuisine, and query filters.
 * Returns paginated, non-sensitive PublicRestaurantProfile cards.
 * Never loads all restaurants across India by default.
 */
export async function discoverRestaurants(
  criteria: RestaurantDiscoveryCriteria
): Promise<PaginatedDiscoveryResult> {
  const city = criteria.city ? criteria.city.trim() : '';
  const trimmedSearchQuery = criteria.searchQuery ? criteria.searchQuery.trim() : '';

  // If no city AND no search query is provided, return empty
  if (!city && !trimmedSearchQuery) {
    return {
      restaurants: [],
      nextCursor: null,
      hasMore: false,
      totalReturned: 0,
      queryCity: '',
      queryArea: criteria.area
    };
  }

  const cityTerms = city ? getCitySearchTerms(city) : [];
  const normalizedArea = (criteria.area || '').trim().toLowerCase();
  const pageSize = Math.min(Math.max(criteria.limit || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  try {
    const publicCol = collection(db, 'publicRestaurants');
    let snapshot;

    if (cityTerms.length > 0) {
      // Query by city variations using Firestore 'in' query or '==' query
      const firestoreCityFilter = cityTerms.length === 1
        ? where('cityLower', '==', cityTerms[0])
        : where('cityLower', 'in', cityTerms.slice(0, 10));

      const q = query(
        publicCol,
        firestoreCityFilter,
        firestoreLimit(pageSize * 3) // Fetch a slightly larger batch for in-memory status/area/cuisine filtering
      );
      snapshot = await getDocs(q);
    } else {
      // Fallback if city is not set but an explicit search query was entered by the user
      const q = query(publicCol, firestoreLimit(MAX_PAGE_SIZE));
      snapshot = await getDocs(q);
    }

    let items: PublicRestaurantProfile[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      // Filter active and online ordering enabled in-memory
      const publicStatus = (data.publicStatus as 'active' | 'paused' | 'closed') || 'active';
      const onlineOrderingEnabled = data.onlineOrderingEnabled ?? true;

      if (publicStatus === 'closed' || onlineOrderingEnabled === false) {
        return;
      }

      items.push({
        restaurantId: data.restaurantId || docSnap.id,
        publicSlug: data.publicSlug,
        publicRestaurantCode: data.publicRestaurantCode,
        name: data.name,
        legalName: data.legalName || undefined,
        logoUrl: data.logoUrl || null,
        bannerImageUrl: data.bannerImageUrl || data.coverImageUrl || null,
        coverImageUrl: data.coverImageUrl || data.bannerImageUrl || null,
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        state: data.state || '',
        area: data.area || '',
        postalCode: data.postalCode || '',
        country: data.country || 'India',
        currency: data.currency || 'INR',
        currencySymbol: data.currencySymbol || '₹',
        cuisine: Array.isArray(data.cuisine) ? data.cuisine : [],
        publicStatus: publicStatus,
        onlineOrderingEnabled: onlineOrderingEnabled,
        takeawayEnabled: data.takeawayEnabled ?? true,
        deliveryEnabled: data.deliveryEnabled ?? true,
        isOpenNow: data.isOpenNow ?? true
      });
    });

    // In-memory precision filtering for area, cuisine, and search query
    if (normalizedArea) {
      items = items.filter((r) => (r.area || '').toLowerCase().includes(normalizedArea));
    }

    if (criteria.cuisine && criteria.cuisine.trim()) {
      const targetCuisine = criteria.cuisine.trim().toLowerCase();
      items = items.filter((r) =>
        r.cuisine.some((c) => c.toLowerCase() === targetCuisine)
      );
    }

    if (criteria.deliveryOnly) {
      items = items.filter((r) => r.deliveryEnabled);
    }

    if (criteria.takeawayOnly) {
      items = items.filter((r) => r.takeawayEnabled);
    }

    if (trimmedSearchQuery) {
      const queryLower = trimmedSearchQuery.toLowerCase();
      items = items.filter((r) =>
        r.name.toLowerCase().includes(queryLower) ||
        r.publicRestaurantCode.toLowerCase().includes(queryLower) ||
        r.publicSlug.toLowerCase().includes(queryLower) ||
        r.area.toLowerCase().includes(queryLower) ||
        r.city.toLowerCase().includes(queryLower) ||
        r.cuisine.some((c) => c.toLowerCase().includes(queryLower))
      );
    }

    const targetPostalCode = criteria.postalCode ? criteria.postalCode.trim() : '';

    // Sort location relevance: exact PIN code matches first, then exact area matches, then exact search matches, then alphabetically by name
    items.sort((a, b) => {
      if (targetPostalCode) {
        const aExactPin = (a.postalCode || '').trim() === targetPostalCode ? 1 : 0;
        const bExactPin = (b.postalCode || '').trim() === targetPostalCode ? 1 : 0;
        if (aExactPin !== bExactPin) return bExactPin - aExactPin;
      }
      if (normalizedArea) {
        const aExactArea = (a.area || '').toLowerCase() === normalizedArea ? 1 : 0;
        const bExactArea = (b.area || '').toLowerCase() === normalizedArea ? 1 : 0;
        if (aExactArea !== bExactArea) return bExactArea - aExactArea;
      }
      if (trimmedSearchQuery) {
        const aExactCode = a.publicRestaurantCode.toUpperCase() === trimmedSearchQuery.toUpperCase() ? 1 : 0;
        const bExactCode = b.publicRestaurantCode.toUpperCase() === trimmedSearchQuery.toUpperCase() ? 1 : 0;
        if (aExactCode !== bExactCode) return bExactCode - aExactCode;
      }
      return a.name.localeCompare(b.name);
    });

    const hasMore = items.length > pageSize;
    const finalItems = hasMore ? items.slice(0, pageSize) : items;
    const nextCursor = hasMore && finalItems.length > 0 ? finalItems[finalItems.length - 1].restaurantId : null;

    return {
      restaurants: finalItems,
      nextCursor,
      hasMore,
      totalReturned: finalItems.length,
      queryCity: city,
      queryArea: criteria.area
    };
  } catch (error: any) {
    console.error('[RestaurantOS Customer Discovery] discoverRestaurants query error:', error);
    throw new Error(
      error?.message || 'Unable to connect to public discovery service. Please check your network connection.'
    );
  }
}

/**
 * Resolves exactly one restaurant by its SEO public slug.
 * Normalizes slug, queries `publicRestaurants`, and verifies single unique match.
 */
export async function resolveRestaurantBySlug(slug: string): Promise<PublicRestaurantProfile | null> {
  const normalizedSlug = slugifyText(slug);
  if (!normalizedSlug) return null;

  const publicCol = collection(db, 'publicRestaurants');
  const q = query(
    publicCol,
    where('publicSlug', '==', normalizedSlug),
    firestoreLimit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return null;
  }

  const docSnap = snapshot.docs[0];
  const data = docSnap.data();
  const status = (data.publicStatus as 'active' | 'paused' | 'closed') || 'active';
  const isOnlineOrdering = data.onlineOrderingEnabled ?? true;
  const isOpen = status === 'active' && isOnlineOrdering;

  return {
    restaurantId: data.restaurantId || docSnap.id,
    publicSlug: data.publicSlug,
    publicRestaurantCode: data.publicRestaurantCode,
    name: data.name,
    legalName: data.legalName || undefined,
    logoUrl: data.logoUrl || null,
    bannerImageUrl: data.bannerImageUrl || data.coverImageUrl || null,
    coverImageUrl: data.coverImageUrl || data.bannerImageUrl || null,
    phone: data.phone || '',
    address: data.address || '',
    city: data.city || '',
    state: data.state || '',
    area: data.area || '',
    postalCode: data.postalCode || '',
    country: data.country || 'India',
    currency: data.currency || 'INR',
    currencySymbol: data.currencySymbol || '₹',
    cuisine: Array.isArray(data.cuisine) ? data.cuisine : [],
    publicStatus: status,
    onlineOrderingEnabled: isOnlineOrdering,
    takeawayEnabled: data.takeawayEnabled ?? true,
    deliveryEnabled: data.deliveryEnabled ?? true,
    isOpenNow: isOpen
  };
}

/**
 * Resolves exactly one restaurant by its short public code (e.g. "R-0YG9I").
 */
export async function resolveRestaurantByPublicCode(code: string): Promise<PublicRestaurantProfile | null> {
  if (!code || !code.trim()) return null;
  const normalizedCode = code.trim().toUpperCase();

  const publicCol = collection(db, 'publicRestaurants');
  const q = query(
    publicCol,
    where('publicRestaurantCode', '==', normalizedCode),
    firestoreLimit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return null;
  }

  const docSnap = snapshot.docs[0];
  const data = docSnap.data();
  const status = (data.publicStatus as 'active' | 'paused' | 'closed') || 'active';
  const isOnlineOrdering = data.onlineOrderingEnabled ?? true;
  const isOpen = status === 'active' && isOnlineOrdering;

  return {
    restaurantId: data.restaurantId || docSnap.id,
    publicSlug: data.publicSlug,
    publicRestaurantCode: data.publicRestaurantCode,
    name: data.name,
    legalName: data.legalName || undefined,
    logoUrl: data.logoUrl || null,
    bannerImageUrl: data.bannerImageUrl || data.coverImageUrl || null,
    coverImageUrl: data.coverImageUrl || data.bannerImageUrl || null,
    phone: data.phone || '',
    address: data.address || '',
    city: data.city || '',
    state: data.state || '',
    area: data.area || '',
    postalCode: data.postalCode || '',
    country: data.country || 'India',
    currency: data.currency || 'INR',
    currencySymbol: data.currencySymbol || '₹',
    cuisine: Array.isArray(data.cuisine) ? data.cuisine : [],
    publicStatus: status,
    onlineOrderingEnabled: isOnlineOrdering,
    takeawayEnabled: data.takeawayEnabled ?? true,
    deliveryEnabled: data.deliveryEnabled ?? true,
    isOpenNow: isOpen
  };
}

/**
 * Resolves exactly one restaurant by its internal restaurantId from the publicRestaurants projection.
 * Never accesses private `restaurants/{restaurantId}` document directly for customer callers.
 */
export async function resolveRestaurantById(restaurantId: string): Promise<PublicRestaurantProfile | null> {
  if (!restaurantId || !restaurantId.trim()) return null;

  const publicDocRef = doc(db, 'publicRestaurants', restaurantId.trim());
  const docSnap = await getDoc(publicDocRef);
  if (!docSnap.exists()) {
    return null;
  }

  const data = docSnap.data();
  const status = (data.publicStatus as 'active' | 'paused' | 'closed') || 'active';
  const isOnlineOrdering = data.onlineOrderingEnabled ?? true;
  const isOpen = status === 'active' && isOnlineOrdering;

  return {
    restaurantId: data.restaurantId || docSnap.id,
    publicSlug: data.publicSlug,
    publicRestaurantCode: data.publicRestaurantCode,
    name: data.name,
    legalName: data.legalName || undefined,
    logoUrl: data.logoUrl || null,
    bannerImageUrl: data.bannerImageUrl || data.coverImageUrl || null,
    coverImageUrl: data.coverImageUrl || data.bannerImageUrl || null,
    phone: data.phone || '',
    address: data.address || '',
    city: data.city || '',
    state: data.state || '',
    area: data.area || '',
    postalCode: data.postalCode || '',
    country: data.country || 'India',
    currency: data.currency || 'INR',
    currencySymbol: data.currencySymbol || '₹',
    cuisine: Array.isArray(data.cuisine) ? data.cuisine : [],
    publicStatus: status,
    onlineOrderingEnabled: isOnlineOrdering,
    takeawayEnabled: data.takeawayEnabled ?? true,
    deliveryEnabled: data.deliveryEnabled ?? true,
    isOpenNow: isOpen
  };
}
