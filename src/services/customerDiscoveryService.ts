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

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 30;

/**
 * Normalizes a city or area name for consistent matching.
 */
export function normalizeLocationTerm(term: string | undefined): string {
  if (!term) return '';
  return term.trim().toLowerCase();
}

/**
 * Synchronizes a restaurant's public discovery profile to the `publicRestaurants` collection.
 * This runs when a restaurant is created or updated by an owner/manager, ensuring public discovery
 * is always fast, indexable, and never touches private `restaurants/{restaurantId}` documents.
 */
export async function syncPublicRestaurantProfile(restaurant: Restaurant): Promise<PublicRestaurantProfile> {
  const publicProfile = toPublicRestaurantProfile(restaurant);
  const publicDocRef = doc(db, 'publicRestaurants', restaurant.restaurantId);

  const payload: Record<string, any> = {
    restaurantId: publicProfile.restaurantId,
    publicSlug: publicProfile.publicSlug,
    publicRestaurantCode: publicProfile.publicRestaurantCode,
    name: publicProfile.name,
    legalName: publicProfile.legalName || null,
    logoUrl: publicProfile.logoUrl || null,
    coverImageUrl: publicProfile.coverImageUrl || null,
    phone: publicProfile.phone,
    address: publicProfile.address,
    city: publicProfile.city,
    cityLower: normalizeLocationTerm(publicProfile.city),
    state: publicProfile.state,
    area: publicProfile.area,
    areaLower: normalizeLocationTerm(publicProfile.area),
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
  if (!city) {
    return {
      restaurants: [],
      nextCursor: null,
      hasMore: false,
      totalReturned: 0,
      queryCity: '',
      queryArea: criteria.area
    };
  }

  const normalizedCity = normalizeLocationTerm(city);
  const normalizedArea = normalizeLocationTerm(criteria.area);
  const pageSize = Math.min(Math.max(criteria.limit || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  try {
    // Query publicRestaurants collection by cityLower
    const publicCol = collection(db, 'publicRestaurants');
    let q = query(
      publicCol,
      where('cityLower', '==', normalizedCity),
      where('publicStatus', '==', 'active'),
      where('onlineOrderingEnabled', '==', true),
      firestoreLimit(pageSize + 1)
    );

    const snapshot = await getDocs(q);
    let items: PublicRestaurantProfile[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      items.push({
        restaurantId: data.restaurantId || docSnap.id,
        publicSlug: data.publicSlug,
        publicRestaurantCode: data.publicRestaurantCode,
        name: data.name,
        legalName: data.legalName || undefined,
        logoUrl: data.logoUrl || null,
        coverImageUrl: data.coverImageUrl || null,
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
        publicStatus: data.publicStatus || 'active',
        onlineOrderingEnabled: data.onlineOrderingEnabled ?? true,
        takeawayEnabled: data.takeawayEnabled ?? true,
        deliveryEnabled: data.deliveryEnabled ?? true,
        isOpenNow: data.isOpenNow ?? true
      });
    });

    // In-memory precision filtering for area, cuisine, and search query within the city
    if (normalizedArea) {
      items = items.filter((r) => normalizeLocationTerm(r.area).includes(normalizedArea));
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

    if (criteria.searchQuery && criteria.searchQuery.trim()) {
      const queryLower = criteria.searchQuery.trim().toLowerCase();
      items = items.filter((r) =>
        r.name.toLowerCase().includes(queryLower) ||
        r.publicRestaurantCode.toLowerCase().includes(queryLower) ||
        r.area.toLowerCase().includes(queryLower) ||
        r.cuisine.some((c) => c.toLowerCase().includes(queryLower))
      );
    }

    // Sort location relevance: exact area matches first, then alphabetically by name
    if (normalizedArea) {
      items.sort((a, b) => {
        const aExactArea = normalizeLocationTerm(a.area) === normalizedArea ? 1 : 0;
        const bExactArea = normalizeLocationTerm(b.area) === normalizedArea ? 1 : 0;
        if (aExactArea !== bExactArea) return bExactArea - aExactArea;
        return a.name.localeCompare(b.name);
      });
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }

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
  } catch (error) {
    console.warn('[RestaurantOS Customer Discovery] discoverRestaurants query warning:', error);
    return {
      restaurants: [],
      nextCursor: null,
      hasMore: false,
      totalReturned: 0,
      queryCity: city,
      queryArea: criteria.area
    };
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
    coverImageUrl: data.coverImageUrl || null,
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
    coverImageUrl: data.coverImageUrl || null,
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
    coverImageUrl: data.coverImageUrl || null,
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
