import { CustomerCart, CustomerCartItem, PublicRestaurantProfile } from '../types/customer';
import { MenuItem } from '../types/menu';

export const CUSTOMER_CART_STORAGE_KEY = 'restaurantos_customer_cart_v1';
export const MAX_SPECIAL_INSTRUCTIONS_LENGTH = 250;
export const MAX_ITEM_QUANTITY = 99;
export const MIN_ITEM_QUANTITY = 1;

/**
 * Calculates item and subtotal summary for customer cart items.
 * Subtotal is calculated in integer paise minor units.
 */
export function calculateCustomerCartTotals(items: CustomerCartItem[]): { subtotal: number; itemCount: number } {
  if (!items || items.length === 0) {
    return { subtotal: 0, itemCount: 0 };
  }

  let subtotal = 0;
  let itemCount = 0;

  for (const item of items) {
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
    const unitPrice = Math.max(0, Math.round(Number(item.price) || 0));
    subtotal += unitPrice * qty;
    itemCount += qty;
  }

  return { subtotal, itemCount };
}

/**
 * Deterministic equality comparison for two cart lines.
 * Compares itemId, variantId, normalized add-ons, and trimmed special instructions.
 */
export function areCustomerCartItemsEqual(a: CustomerCartItem, b: CustomerCartItem): boolean {
  if (!a || !b) return false;
  if (a.itemId !== b.itemId) return false;

  const variantA = a.selectedVariantId || '';
  const variantB = b.selectedVariantId || '';
  if (variantA !== variantB) return false;

  // Normalize and compare add-ons by sorted addonId
  const addonsA = (a.selectedAddons || []).slice().sort((x, y) => x.addonId.localeCompare(y.addonId));
  const addonsB = (b.selectedAddons || []).slice().sort((x, y) => x.addonId.localeCompare(y.addonId));

  if (addonsA.length !== addonsB.length) return false;
  for (let i = 0; i < addonsA.length; i++) {
    if (addonsA[i].addonId !== addonsB[i].addonId) return false;
    if (Math.round(addonsA[i].price) !== Math.round(addonsB[i].price)) return false;
  }

  // Normalize special instructions
  const noteA = (a.itemNotes || '').trim();
  const noteB = (b.itemNotes || '').trim();
  if (noteA !== noteB) return false;

  return true;
}

/**
 * Sanitizes and validates a customer cart item before adding to cart.
 */
export function sanitizeCustomerCartItem(item: CustomerCartItem): CustomerCartItem {
  const safeQty = Math.min(
    MAX_ITEM_QUANTITY,
    Math.max(MIN_ITEM_QUANTITY, Math.floor(Number(item.quantity) || 1))
  );
  const safePrice = Math.max(0, Math.round(Number(item.price) || 0));
  
  const sanitizedNotes = item.itemNotes
    ? item.itemNotes.trim().slice(0, MAX_SPECIAL_INSTRUCTIONS_LENGTH)
    : undefined;

  const sanitizedAddons = item.selectedAddons
    ? item.selectedAddons.map((addon) => ({
        addonId: String(addon.addonId || ''),
        name: String(addon.name || '').trim(),
        price: Math.max(0, Math.round(Number(addon.price) || 0))
      }))
    : undefined;

  return {
    ...item,
    cartItemId: item.cartItemId || `cart-item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    itemId: String(item.itemId || ''),
    name: String(item.name || '').trim(),
    price: safePrice,
    quantity: safeQty,
    selectedVariantId: item.selectedVariantId ? String(item.selectedVariantId) : undefined,
    selectedVariantName: item.selectedVariantName ? String(item.selectedVariantName).trim() : undefined,
    selectedAddons: sanitizedAddons,
    itemNotes: sanitizedNotes || undefined,
    imageUrl: item.imageUrl || null,
    isVeg: typeof item.isVeg === 'boolean' ? item.isVeg : undefined,
    foodType: item.foodType
  };
}

/**
 * Loads customer cart from localStorage with defensive validation.
 */
export function loadCustomerCartFromStorage(): CustomerCart | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CUSTOMER_CART_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.restaurantId || !Array.isArray(parsed.items)) {
      return null;
    }

    const sanitizedItems: CustomerCartItem[] = [];
    for (const item of parsed.items) {
      if (item && item.itemId && typeof item.price === 'number') {
        sanitizedItems.push(sanitizeCustomerCartItem(item));
      }
    }

    if (sanitizedItems.length === 0) {
      return null;
    }

    const { subtotal, itemCount } = calculateCustomerCartTotals(sanitizedItems);

    return {
      restaurantId: String(parsed.restaurantId),
      restaurantName: String(parsed.restaurantName || 'Restaurant'),
      publicSlug: String(parsed.publicSlug || ''),
      publicRestaurantCode: parsed.publicRestaurantCode ? String(parsed.publicRestaurantCode) : undefined,
      currency: parsed.currency || 'INR',
      currencySymbol: parsed.currencySymbol || '₹',
      items: sanitizedItems,
      subtotal,
      itemCount
    };
  } catch (err) {
    console.warn('[RestaurantOS] Error loading customer cart from storage:', err);
    return null;
  }
}

/**
 * Saves customer cart to localStorage.
 */
export function saveCustomerCartToStorage(cart: CustomerCart | null): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    if (!cart || !cart.restaurantId || cart.items.length === 0) {
      window.localStorage.removeItem(CUSTOMER_CART_STORAGE_KEY);
      return;
    }

    // Persist only non-sensitive customer cart representation
    const minimalCart: CustomerCart = {
      restaurantId: cart.restaurantId,
      restaurantName: cart.restaurantName,
      publicSlug: cart.publicSlug,
      publicRestaurantCode: cart.publicRestaurantCode,
      currency: cart.currency || 'INR',
      currencySymbol: cart.currencySymbol || '₹',
      items: cart.items.map(sanitizeCustomerCartItem),
      subtotal: cart.subtotal,
      itemCount: cart.itemCount
    };

    window.localStorage.setItem(CUSTOMER_CART_STORAGE_KEY, JSON.stringify(minimalCart));
  } catch (err) {
    console.warn('[RestaurantOS] Error saving customer cart to storage:', err);
  }
}

/**
 * Clears saved cart from localStorage.
 */
export function clearSavedCustomerCart(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(CUSTOMER_CART_STORAGE_KEY);
  } catch (err) {
    console.warn('[RestaurantOS] Error clearing customer cart storage:', err);
  }
}

export interface StaleCartValidationResult {
  isValid: boolean;
  issues: string[];
  staleItemIds: string[];
  isRestaurantUnavailable: boolean;
  isOrderingDisabled: boolean;
}

/**
 * Validates a cart against current authoritative restaurant profile and menu catalog.
 * Detects unavailable items, deleted items, closed restaurants, or disabled online ordering.
 */
export function validateCustomerCart(
  cart: CustomerCart | null,
  restaurantProfile?: PublicRestaurantProfile | null,
  menuItems?: MenuItem[]
): StaleCartValidationResult {
  const issues: string[] = [];
  const staleItemIds: string[] = [];
  let isRestaurantUnavailable = false;
  let isOrderingDisabled = false;

  if (!cart || cart.items.length === 0) {
    return {
      isValid: true,
      issues: [],
      staleItemIds: [],
      isRestaurantUnavailable: false,
      isOrderingDisabled: false
    };
  }

  // 1. Restaurant status check
  if (restaurantProfile) {
    if (restaurantProfile.restaurantId !== cart.restaurantId) {
      issues.push(`Cart belongs to restaurant ${cart.restaurantName}, not ${restaurantProfile.name}.`);
    }

    if (restaurantProfile.publicStatus === 'closed') {
      issues.push('Restaurant is currently closed and not accepting orders.');
      isRestaurantUnavailable = true;
    } else if (restaurantProfile.publicStatus === 'paused') {
      issues.push('Restaurant is temporarily paused and not accepting new orders.');
      isRestaurantUnavailable = true;
    }

    if (!restaurantProfile.onlineOrderingEnabled) {
      issues.push('Online ordering is currently disabled for this restaurant.');
      isOrderingDisabled = true;
    }
  }

  // 2. Menu items availability check
  if (menuItems && menuItems.length > 0) {
    const itemMap = new Map<string, MenuItem>();
    menuItems.forEach((item) => {
      if (item && item.itemId) {
        itemMap.set(item.itemId, item);
      }
    });

    for (const cartItem of cart.items) {
      const liveItem = itemMap.get(cartItem.itemId);
      if (!liveItem) {
        issues.push(`"${cartItem.name}" is no longer available on the menu.`);
        staleItemIds.push(cartItem.itemId);
        continue;
      }

      if (liveItem.isActive === false || liveItem.isAvailable === false) {
        issues.push(`"${cartItem.name}" is currently out of stock.`);
        staleItemIds.push(cartItem.itemId);
        continue;
      }

      // Check variant validity
      if (cartItem.selectedVariantId && liveItem.variants) {
        const variantExists = liveItem.variants.some((v) => v.id === cartItem.selectedVariantId);
        if (!variantExists) {
          issues.push(`Selected option for "${cartItem.name}" is no longer offered.`);
          staleItemIds.push(cartItem.itemId);
        }
      }

      // Check add-ons validity
      if (cartItem.selectedAddons && cartItem.selectedAddons.length > 0 && liveItem.addons) {
        const addonMap = new Set(liveItem.addons.map((a) => a.id));
        const hasInvalidAddon = cartItem.selectedAddons.some((a) => !addonMap.has(a.addonId));
        if (hasInvalidAddon) {
          issues.push(`One or more add-ons for "${cartItem.name}" are no longer available.`);
          staleItemIds.push(cartItem.itemId);
        }
      }
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    staleItemIds,
    isRestaurantUnavailable,
    isOrderingDisabled
  };
}
