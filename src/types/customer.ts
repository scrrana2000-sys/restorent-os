import { PublicRestaurantStatus } from './restaurant';
import { PaymentMethod } from './payment';

export type { PublicRestaurantStatus, PaymentMethod };

/**
 * Public Customer-facing Restaurant Discovery Profile.
 * Contains only non-sensitive fields safe for public listing and search.
 */
export interface PublicRestaurantProfile {
  restaurantId: string;
  publicSlug: string;
  publicRestaurantCode: string;
  name: string;
  legalName?: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  phone: string;
  address: string;
  city: string;
  state: string;
  area: string;
  postalCode: string;
  country: string;
  currency: string;
  currencySymbol: string;
  cuisine: string[];
  publicStatus: PublicRestaurantStatus;
  onlineOrderingEnabled: boolean;
  takeawayEnabled: boolean;
  deliveryEnabled: boolean;
  approxDistanceKm?: number;
  isOpenNow?: boolean;
}

/**
 * Discovery search criteria for public restaurant listings.
 */
export interface RestaurantDiscoveryCriteria {
  city: string;
  state?: string;
  area?: string;
  postalCode?: string;
  searchQuery?: string;
  cuisine?: string;
  deliveryOnly?: boolean;
  takeawayOnly?: boolean;
  limit?: number;
  cursor?: string | null;
}

/**
 * Filter state for customer discovery UI.
 */
export interface CustomerRestaurantFilterState {
  searchQuery: string;
  selectedCuisine: string | null;
  deliveryOnly: boolean;
  takeawayOnly: boolean;
  onlineOrderingOnly: boolean;
  selectedArea: string | null;
}

/**
 * Paginated discovery query response.
 */
export interface PaginatedDiscoveryResult {
  restaurants: PublicRestaurantProfile[];
  nextCursor: string | null;
  hasMore: boolean;
  totalReturned: number;
  queryCity: string;
  queryArea?: string;
}

/**
 * Customer location context information.
 * Allows geolocation detection with manual city fallback.
 */
export interface CustomerLocation {
  city: string;
  state?: string;
  area?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  source: 'gps' | 'manual' | 'city-selection' | 'pincode' | 'default';
  isApproximate: boolean;
}

/**
 * Customer Cart Item representing an item selected from a specific restaurant.
 */
export interface CustomerCartItem {
  cartItemId: string;
  itemId: string;
  name: string;
  foodType?: 'veg' | 'nonVeg' | 'egg' | 'vegan' | 'other' | string;
  price: number; // in paise
  unitPrice?: number; // in paise
  quantity: number;
  taxRate?: number;
  taxInclusive?: boolean;
  selectedVariantId?: string;
  selectedVariantName?: string;
  selectedAddons?: Array<{
    addonId: string;
    name: string;
    price: number; // in paise
  }>;
  itemNotes?: string;
  imageUrl?: string | null;
  isVeg?: boolean;
}

/**
 * Customer Cart State strictly bound to a single restaurant tenant.
 */
export interface CustomerCart {
  restaurantId: string;
  restaurantName: string;
  publicSlug: string;
  publicRestaurantCode?: string;
  currency?: string;
  currencySymbol?: string;
  items: CustomerCartItem[];
  subtotal: number; // in paise
  taxTotal?: number; // in paise
  grandTotal?: number; // in paise
  itemCount: number;
}

/**
  * Minimal customer contact information required for online orders.
  */
export interface CustomerCheckoutDetails {
  name: string;
  phone: string;
}

/**
  * Delivery address details required ONLY when orderType === 'delivery'.
  */
export interface CustomerDeliveryDetails {
  recipientName?: string;
  phone?: string;
  addressLine: string;
  area: string;
  city: string;
  state?: string;
  postalCode: string;
  deliveryInstructions?: string;
}

/**
  * Customer Checkout Intent structure created at M9-H boundary.
  * Inputs and validated cart state ready for M9-I authoritative submission.
  */
export interface CustomerCheckoutIntent {
  restaurantId: string;
  restaurantName: string;
  orderType: 'takeaway' | 'delivery' | 'dineIn';
  customerDetails: CustomerCheckoutDetails;
  deliveryDetails?: CustomerDeliveryDetails;
  items: CustomerCartItem[];
  subtotal: number; // in paise (client estimate)
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  createdAt: string;
}

/**
  * Customer Checkout Validation Result.
  */
export interface CheckoutValidationResult {
  isValid: boolean;
  errors: {
    customerName?: string;
    customerPhone?: string;
    deliveryAddressLine?: string;
    deliveryArea?: string;
    deliveryCity?: string;
    deliveryPostalCode?: string;
    orderType?: string;
    paymentMethod?: string;
    cart?: string;
    general?: string;
  };
  issues: string[];
}

