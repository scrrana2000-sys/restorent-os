import { Restaurant } from '../types/restaurant';
import { PublicRestaurantProfile } from '../types/customer';
import { getRestaurantOperatingProfile } from '../config/restaurantOperatingModes';

/**
 * Normalizes any text into a URL-safe, SEO-friendly slug string.
 * Strips special characters, collapses consecutive dashes, and lowercases.
 */
export function slugifyText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric except whitespace and hyphens
    .replace(/[\s_]+/g, '-')     // collapse whitespace and underscores to single hyphen
    .replace(/-+/g, '-')         // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');    // trim leading and trailing hyphens
}

/**
 * Generates a deterministic short public alphanumeric code from restaurantId.
 * e.g., "rest_1789449559093_00yg9i" -> "R9559093" or "ROS-7894"
 * Ensures non-sensitive, clean, uppercase, 6-8 chars.
 */
export function generatePublicRestaurantCode(restaurantId: string): string {
  if (!restaurantId) return 'ROS-0000';
  
  // Extract alphanumeric parts
  const clean = restaurantId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length <= 8) {
    return clean;
  }
  
  // Take first 3 chars + last 4 chars for collision resistance
  const prefix = clean.startsWith('REST') ? 'R' : clean.substring(0, 3);
  const suffix = clean.substring(clean.length - 5);
  return `${prefix}-${suffix}`;
}

/**
 * Generates a base public slug candidate from restaurant name, city, and optional area.
 * e.g., "Sharma Family Restaurant", "Raichur" -> "sharma-family-restaurant-raichur"
 */
export function generateBaseRestaurantSlug(name: string, city?: string, area?: string): string {
  const parts: string[] = [];
  if (name && name.trim()) parts.push(name.trim());
  if (area && area.trim()) parts.push(area.trim());
  if (city && city.trim()) parts.push(city.trim());

  const raw = parts.join(' ');
  const slug = slugifyText(raw);
  return slug || 'restaurant';
}

/**
 * Generates a collision-safe deterministic public slug for a restaurant using its immutable restaurantId.
 * If base slug is already unique or during default generation, appends a short hash suffix derived from restaurantId.
 */
export function generateDeterministicRestaurantSlug(restaurant: Pick<Restaurant, 'restaurantId' | 'name' | 'city' | 'area'>): string {
  const base = generateBaseRestaurantSlug(restaurant.name, restaurant.city, restaurant.area);
  const suffix = (restaurant.restaurantId || '').replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase();
  
  if (!suffix) return base;
  return `${base}-${suffix}`;
}

/**
 * Extracts and maps a Restaurant document into a safe, non-sensitive PublicRestaurantProfile.
 * Never exposes ownerId, legal tax numbers, staff/membership info, or financial data.
 */
export function toPublicRestaurantProfile(restaurant: Restaurant): PublicRestaurantProfile {
  const operatingProfile = getRestaurantOperatingProfile(restaurant);
  const capabilities = operatingProfile.capabilities;

  const resolvedSlug = restaurant.publicSlug || generateDeterministicRestaurantSlug(restaurant);
  const resolvedCode = restaurant.publicRestaurantCode || generatePublicRestaurantCode(restaurant.restaurantId);

  return {
    restaurantId: restaurant.restaurantId,
    publicSlug: resolvedSlug,
    publicRestaurantCode: resolvedCode,
    name: restaurant.name || 'Restaurant',
    legalName: restaurant.legalName || undefined,
    logoUrl: restaurant.logoUrl || null,
    bannerImageUrl: restaurant.bannerImageUrl || restaurant.coverImageUrl || null,
    coverImageUrl: restaurant.coverImageUrl || restaurant.bannerImageUrl || null,
    phone: restaurant.phone || '',
    address: restaurant.address || '',
    city: restaurant.city || '',
    state: restaurant.state || '',
    area: restaurant.area || '',
    postalCode: restaurant.postalCode || '',
    country: restaurant.country || 'India',
    currency: restaurant.currency || 'INR',
    currencySymbol: restaurant.currencySymbol || '₹',
    cuisine: Array.isArray(restaurant.cuisine) ? restaurant.cuisine : [],
    publicStatus: restaurant.publicStatus || (restaurant.isActive ? 'active' : 'closed'),
    onlineOrderingEnabled: restaurant.onlineOrderingEnabled !== undefined ? restaurant.onlineOrderingEnabled : true,
    takeawayEnabled: capabilities.takeawayEnabled,
    deliveryEnabled: capabilities.deliveryEnabled,
    isOpenNow: restaurant.isActive && (restaurant.publicStatus === 'active' || !restaurant.publicStatus)
  };
}
