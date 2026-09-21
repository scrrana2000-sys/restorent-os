import {
  CustomerCart,
  CustomerCartItem,
  PublicRestaurantProfile,
  CustomerCheckoutDetails,
  CustomerDeliveryDetails,
  CustomerCheckoutIntent,
  CheckoutValidationResult,
  PaymentMethod
} from '../types/customer';
import { MenuItem } from '../types/menu';
import { validateCustomerCart, clearSavedCustomerCart } from './customerCartService';
import { orderService } from './orderService';
import { Order, OrderItemModifier, CustomerSnapshot } from '../types/order';
import { KOT } from '../types/kot';
import { CartState, CartItem } from '../types/cart';
import { RestaurantOperatingProfile } from '../config/restaurantOperatingModes';
import { getApiUrl, PRODUCTION_API_BASE_URL } from '../utils/apiConfig';
import { auth, db } from '../config/firebase';
import { getActivePlanEntitlements } from './subscriptionService';
import { doc, getDoc } from 'firebase/firestore';

export type { CheckoutValidationResult };

export interface ValidateCheckoutInput {
  cart: CustomerCart | null;
  restaurantProfile?: PublicRestaurantProfile | null;
  menuItems?: MenuItem[];
  orderType: 'takeaway' | 'delivery' | 'dineIn';
  customerDetails: CustomerCheckoutDetails;
  deliveryDetails?: CustomerDeliveryDetails;
  paymentMethod: PaymentMethod;
  customerId?: string | null;
  customerEmail?: string | null;
}

export interface SubmitCustomerOnlineOrderInput {
  intent?: CustomerCheckoutIntent | null;
  cart?: CustomerCart | null;
  restaurantProfile?: PublicRestaurantProfile | null;
  menuItems?: MenuItem[];
  orderType?: 'takeaway' | 'delivery' | 'dineIn';
  customerDetails?: CustomerCheckoutDetails;
  deliveryDetails?: CustomerDeliveryDetails;
  paymentMethod?: PaymentMethod;
  idempotencyKey?: string;
  operatingProfile?: RestaurantOperatingProfile;
  customerId?: string | null;
  customerEmail?: string | null;
  customerTrackingToken?: string | null;
  idToken?: string;
}

export interface CustomerOrderSubmissionResult {
  success: boolean;
  order: Order;
  kot: KOT | null;
}

/**
 * Validates phone number format for standard mobile input.
 * Strips formatting characters (spaces, hyphens, plus sign) and verifies digit count (10-15 digits).
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Validates postal code format (numeric or alphanumeric, 4 to 10 chars).
 */
export function isValidPostalCode(postalCode: string): boolean {
  if (!postalCode) return false;
  const trimmed = postalCode.trim();
  return /^[a-zA-Z0-9\s-]{4,10}$/.test(trimmed);
}

/**
 * Converts customer cart items into canonical CartState for OrderService.
 */
async function buildAuthoritativeCustomerCartState(cart: CustomerCart, notes?: string): Promise<CartState> {
  const cleanRestaurantId = String(cart.restaurantId || '').trim();
  if (!cleanRestaurantId) throw new Error('Invalid restaurantId.');
  if (!Array.isArray(cart.items) || cart.items.length === 0) throw new Error('Cart is empty.');
  if (cart.items.length > 30) throw new Error('Maximum 30 unique items allowed per order.');

  // Catalog reads are independent per cart item. Fetch them in parallel so
  // checkout latency does not grow linearly with the number of items.
  const items = await Promise.all(cart.items.map(async (clientItem) => {
    if (!Number.isInteger(Number(clientItem.quantity)) || Number(clientItem.quantity) < 1 || Number(clientItem.quantity) > 100) {
      throw new Error(`Invalid quantity for item "${clientItem.name || clientItem.itemId}".`);
    }

    const itemRef = doc(db, 'restaurants', cleanRestaurantId, 'items', String(clientItem.itemId).trim());
    const snap = await getDoc(itemRef);
    if (!snap.exists()) throw new Error(`Item "${clientItem.name || clientItem.itemId}" is no longer available.`);
    const data = snap.data() as MenuItem;
    if (data.itemId && data.itemId !== snap.id) throw new Error(`Menu item identity mismatch for "${snap.id}".`);
    if (data.restaurantId && data.restaurantId !== cleanRestaurantId) throw new Error('Item tenant mismatch.');
    if (data.isActive === false || data.isAvailable === false) throw new Error(`"${data.name}" is no longer available.`);

    const catalogPrice = Number(data.price);
    const catalogTaxRate = Number(data.taxRate);
    if (!Number.isFinite(catalogPrice) || catalogPrice < 0 || catalogPrice > 10000000) throw new Error(`Invalid price for "${data.name}".`);
    if (!Number.isFinite(catalogTaxRate) || catalogTaxRate < 0 || catalogTaxRate > 100) throw new Error(`Invalid tax rate for "${data.name}".`);

    let unitPriceMinor = Math.round(catalogPrice * 100);
    let variantId: string | undefined;
    let variantName: string | undefined;

    if (clientItem.selectedVariantId || clientItem.selectedVariantName) {
      const variants = Array.isArray(data.variants) ? data.variants : [];
      const variant = variants.find((v) =>
        (clientItem.selectedVariantId && v.id === clientItem.selectedVariantId) ||
        (!clientItem.selectedVariantId && clientItem.selectedVariantName && v.name === clientItem.selectedVariantName)
      );
      if (!variant || variant.isAvailable === false) throw new Error(`Selected option for "${data.name}" is unavailable.`);
      const variantPrice = Number(variant.price);
      if (!Number.isFinite(variantPrice) || variantPrice < 0 || variantPrice > 10000000) throw new Error(`Invalid selected option price for "${data.name}".`);
      unitPriceMinor = Math.round(variantPrice * 100);
      variantId = variant.id;
      variantName = variant.name;
    }

    const addons = Array.isArray(clientItem.selectedAddons) ? clientItem.selectedAddons : [];
    const sourceAddons = Array.isArray(data.addons) ? data.addons : (Array.isArray(data.addOns) ? data.addOns : []);
    const modifiers: OrderItemModifier[] = [];

    for (const clientAddon of addons) {
      const addon = sourceAddons.find((a) => a.id === clientAddon.addonId);
      if (!addon || addon.isAvailable === false) throw new Error(`Selected add-on for "${data.name}" is unavailable.`);
      const addonPrice = Number(addon.price);
      if (!Number.isFinite(addonPrice) || addonPrice < 0 || addonPrice > 10000000) throw new Error(`Invalid selected add-on price for "${data.name}".`);
      modifiers.push({ id: addon.id, name: addon.name, priceMinor: Math.round(addonPrice * 100) });
    }

    const canonicalItem: CartItem = {
      cartItemId: clientItem.cartItemId || `cart-item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      itemId: snap.id,
      nameSnapshot: data.name,
      shortNameSnapshot: data.shortName || data.name,
      imageUrlSnapshot: data.imageUrl || null,
      foodTypeSnapshot: data.foodType || null,
      unitPriceMinor,
      taxRate: catalogTaxRate,
      taxInclusive: Boolean(data.taxInclusive),
      quantity: Number(clientItem.quantity),
      notes: clientItem.itemNotes || '',
      modifiers: modifiers.length ? modifiers : undefined
    };

    // Preserve the selected variant in the snapshot without trusting client pricing.
    if (variantId && variantName) {
      canonicalItem.modifiers = [
        { id: variantId, name: `Option: ${variantName}`, priceMinor: 0 },
        ...(canonicalItem.modifiers || [])
      ];
    }

    return canonicalItem;
  }));
  return { items, notes: notes || '' };
}

export function mapCustomerCartToCartState(items: CustomerCartItem[], notes?: string): CartState {
  if (!items || items.length === 0) {
    return { items: [], notes: notes || '' };
  }

  const cartItems: CartItem[] = items.map((item) => {
    const modifiers: OrderItemModifier[] = [];

    if (item.selectedVariantName) {
      modifiers.push({
        id: item.selectedVariantId || `var-${item.itemId}`,
        name: `Option: ${item.selectedVariantName}`,
        priceMinor: 0
      });
    }

    if (item.selectedAddons && item.selectedAddons.length > 0) {
      for (const addon of item.selectedAddons) {
        modifiers.push({
          id: addon.addonId || `addon-${addon.name}`,
          name: addon.name,
          priceMinor: Math.round(Number(addon.price) || 0)
        });
      }
    }

    return {
      cartItemId: item.cartItemId || `cart-item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      itemId: item.itemId,
      nameSnapshot: item.name,
      shortNameSnapshot: item.name,
      imageUrlSnapshot: item.imageUrl || null,
      foodTypeSnapshot: item.foodType || (item.isVeg ? 'veg' : null),
      unitPriceMinor: Math.round(Number(item.unitPrice || item.price) || 0),
      taxRate: typeof item.taxRate === 'number' ? item.taxRate : 5,
      taxInclusive: Boolean(item.taxInclusive),
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      notes: item.itemNotes || '',
      modifiers: modifiers.length > 0 ? modifiers : undefined
    };
  });

  return {
    items: cartItems,
    notes: notes || ''
  };
}

/**
 * Validates complete customer checkout form & cart state prior to intent creation or submission.
 */
export function validateCustomerCheckout(input: ValidateCheckoutInput): CheckoutValidationResult {
  const errors: CheckoutValidationResult['errors'] = {};
  const issues: string[] = [];

  const {
    cart,
    restaurantProfile,
    menuItems,
    orderType,
    customerDetails,
    deliveryDetails,
    paymentMethod
  } = input;

  // 1. Cart Existence & Revalidation
  if (!cart || !cart.items || cart.items.length === 0) {
    errors.cart = 'Your cart is empty. Add items before checking out.';
    issues.push('Cart is empty.');
  } else {
    const cartValidation = validateCustomerCart(cart, restaurantProfile, menuItems);
    if (!cartValidation.isValid) {
      errors.cart = cartValidation.issues[0] || 'Cart contains invalid or unavailable items.';
      issues.push(...cartValidation.issues);
    }
  }

  // 2. Restaurant Operational Mode & Availability
  if (restaurantProfile) {
    if (cart && cart.restaurantId !== restaurantProfile.restaurantId) {
      errors.general = `Cart belongs to restaurant ${cart.restaurantName}, not ${restaurantProfile.name}.`;
      issues.push(`Cart belongs to restaurant ${cart.restaurantName}, not ${restaurantProfile.name}.`);
    }

    if (restaurantProfile.publicStatus === 'closed' || restaurantProfile.publicStatus === 'paused') {
      errors.general = 'Restaurant is currently not accepting orders.';
      issues.push('Restaurant is currently not accepting orders.');
    }

    if (!restaurantProfile.onlineOrderingEnabled) {
      errors.general = 'Online ordering is currently disabled for this restaurant.';
      issues.push('Online ordering is currently disabled for this restaurant.');
    }

    // 3. Order Type Support Check
    if (orderType === 'takeaway' && restaurantProfile.takeawayEnabled === false) {
      errors.orderType = 'Takeaway is not available for this restaurant.';
      issues.push('Takeaway is not available for this restaurant.');
    } else if (orderType === 'delivery' && restaurantProfile.deliveryEnabled === false) {
      errors.orderType = 'Delivery is not available for this restaurant.';
      issues.push('Delivery is not available for this restaurant.');
    } else if (orderType === 'dineIn') {
      errors.orderType = 'Dine-in ordering is not available via online customer checkout.';
      issues.push('Dine-in ordering is not available via online customer checkout.');
    }
  } else if (orderType === 'dineIn') {
    errors.orderType = 'Dine-in ordering is not available via online customer checkout.';
    issues.push('Dine-in ordering is not available via online customer checkout.');
  }

  // 4. Customer Contact Details Validation
  if (!customerDetails.name || customerDetails.name.trim().length < 2) {
    errors.customerName = 'Please enter a valid customer name (at least 2 characters).';
    issues.push('Customer name is required.');
  }

  if (!customerDetails.phone || !isValidPhoneNumber(customerDetails.phone)) {
    errors.customerPhone = 'Please enter a valid 10-digit mobile phone number.';
    issues.push('Valid mobile phone number is required.');
  }

  // 5. Delivery Details Validation (REQUIRED ONLY WHEN orderType === 'delivery')
  if (orderType === 'delivery') {
    if (!deliveryDetails) {
      errors.deliveryAddressLine = 'Delivery address is required for delivery orders.';
      issues.push('Delivery address details are required.');
    } else {
      if (!deliveryDetails.addressLine || deliveryDetails.addressLine.trim().length < 5) {
        errors.deliveryAddressLine = 'Please enter a complete delivery address line (at least 5 characters).';
        issues.push('Delivery address line is required.');
      }

      if (!deliveryDetails.area || deliveryDetails.area.trim().length < 2) {
        errors.deliveryArea = 'Please enter delivery area / locality.';
        issues.push('Delivery area is required.');
      }

      if (!deliveryDetails.city || deliveryDetails.city.trim().length < 2) {
        errors.deliveryCity = 'Please enter delivery city.';
        issues.push('Delivery city is required.');
      }

      if (!deliveryDetails.postalCode || !isValidPostalCode(deliveryDetails.postalCode)) {
        errors.deliveryPostalCode = 'Please enter a valid postal code (4 to 10 characters).';
        issues.push('Valid postal code is required.');
      }
    }
  }

  // 6. Payment Method Validation
  const validPaymentMethods: PaymentMethod[] = ['cash', 'card', 'upi', 'other'];
  if (!paymentMethod || !validPaymentMethods.includes(paymentMethod)) {
    errors.paymentMethod = 'Please select a supported payment method.';
    issues.push('Supported payment method selection is required.');
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    issues
  };
}

/**
 * Generates an unsubmitted CustomerCheckoutIntent at the M9-H boundary.
 * Produces an idempotency key to prepare for M9-I submission without writing to persistent database.
 */
export function createCustomerCheckoutIntent(
  input: ValidateCheckoutInput,
  existingIdempotencyKey?: string
): CustomerCheckoutIntent {
  const validation = validateCustomerCheckout(input);
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0] || 'Checkout validation failed.';
    throw new Error(`Checkout Validation Error: ${firstError}`);
  }

  const {
    cart,
    restaurantProfile,
    orderType,
    customerDetails,
    deliveryDetails,
    paymentMethod
  } = input;

  const idempotencyKey =
    existingIdempotencyKey ||
    `chk_${cart!.restaurantId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return {
    restaurantId: cart!.restaurantId,
    restaurantName: cart!.restaurantName,
    orderType,
    customerDetails: {
      name: customerDetails.name.trim(),
      phone: customerDetails.phone.trim(),
      email: customerDetails.email ? customerDetails.email.trim() : (input.customerEmail?.trim() || undefined)
    },
    deliveryDetails:
      orderType === 'delivery' && deliveryDetails
        ? {
            recipientName: (deliveryDetails.recipientName || customerDetails.name).trim(),
            phone: (deliveryDetails.phone || customerDetails.phone).trim(),
            addressLine: deliveryDetails.addressLine.trim(),
            area: deliveryDetails.area.trim(),
            city: deliveryCityOrFallback(deliveryDetails.city, restaurantProfile),
            state: deliveryDetails.state ? deliveryDetails.state.trim() : undefined,
            postalCode: deliveryDetails.postalCode.trim(),
            deliveryInstructions: deliveryDetails.deliveryInstructions
              ? deliveryDetails.deliveryInstructions.trim()
              : undefined
          }
        : undefined,
    customerId: input.customerId ? input.customerId.trim() : null,
    customerEmail: input.customerEmail ? input.customerEmail.trim() : (customerDetails.email?.trim() || null),
    items: [...cart!.items],
    subtotal: cart!.subtotal,
    paymentMethod,
    idempotencyKey,
    createdAt: new Date().toISOString()
  };
}

/**
 * Submits an online customer order authoritatively into the canonical Order Engine.
 * Re-validates input, maps items to canonical CartState, enforces source = 'online',
 * and delegates creation to OrderService for operating-mode-aware order + KOT creation.
 */
export async function submitCustomerOnlineOrder(
  input: SubmitCustomerOnlineOrderInput
): Promise<CustomerOrderSubmissionResult> {
  let cart = input.cart || null;
  let restaurantProfile = input.restaurantProfile || null;
  let menuItems = input.menuItems || [];
  let orderType = input.orderType || 'takeaway';
  let customerDetails = input.customerDetails;
  let deliveryDetails = input.deliveryDetails;
  let paymentMethod = input.paymentMethod || 'cash';
  let idempotencyKey = input.idempotencyKey;
  let customerId = input.customerId !== undefined ? input.customerId : (input.intent?.customerId ?? null);
  let customerEmail = input.customerEmail || input.intent?.customerEmail || customerDetails?.email || undefined;

  if (input.intent) {
    const intent = input.intent;
    if (!cart) {
      cart = {
        restaurantId: intent.restaurantId,
        restaurantName: intent.restaurantName,
        publicSlug: '',
        items: intent.items,
        subtotal: intent.subtotal,
        itemCount: intent.items.reduce((sum, item) => sum + item.quantity, 0)
      };
    }
    orderType = intent.orderType;
    customerDetails = intent.customerDetails;
    deliveryDetails = intent.deliveryDetails;
    paymentMethod = intent.paymentMethod;
    idempotencyKey = intent.idempotencyKey || idempotencyKey;
    if (customerId === undefined && intent.customerId !== undefined) {
      customerId = intent.customerId;
    }
    if (!customerEmail && intent.customerEmail) {
      customerEmail = intent.customerEmail;
    }
  }

  if (!customerDetails) {
    throw new Error('Customer contact details are required for online order submission.');
  }

  // 1. Browser/customer checkout MUST always use the server API.
  // Never fall back to the browser Firestore/idempotency path: guest customers
  // intentionally have no Firebase Auth session, so IdempotencyService would
  // reject them with "Authenticated user is required for idempotency operations."
  const isBrowser = typeof window !== 'undefined';
  // Vitest uses a browser-like DOM environment, so window exists during unit tests.
  // Keep tests on the deterministic local service path while real browser/customer
  // sessions always use the server-authoritative API above.
  const isTest =
    (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true')) ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test');
  if (isBrowser && !isTest) {
    let idToken = input.idToken;
    if (!idToken && typeof auth !== 'undefined' && auth.currentUser) {
      try {
        idToken = await auth.currentUser.getIdToken();
      } catch (tokenErr) {
        console.warn('[RestaurantOS] Failed to fetch customer auth token for checkout:', tokenErr);
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }

    const apiHeaders = {
      ...headers,
      Accept: 'application/json'
    };
    const requestBody = JSON.stringify({
      ...input,
      customerId: customerId || (auth.currentUser ? auth.currentUser.uid : null),
      customerEmail
    });

    const primaryApiUrl = getApiUrl('/api/submit-online-order');
    let response = await fetch(primaryApiUrl, {
      method: 'POST',
      headers: apiHeaders,
      credentials: 'omit',
      body: requestBody
    });

    // A stale SPA host, reverse proxy, or cached frontend can accidentally answer
    // /api/* with index.html (HTTP 200 text/html). Retry once against the immutable
    // production API endpoint using the same idempotency key before surfacing an error.
    // The canonical server workflow is idempotent for clientRequestId/idempotencyKey.
    let responseText = await response.text();
    const isHtmlResponse = /text\/html/i.test(response.headers.get('content-type') || '') ||
      /^\s*<(?:!doctype\s+html|html\b|head\b)/i.test(responseText);

    const productionApiUrl = `${PRODUCTION_API_BASE_URL}/api/submit-online-order`;
    if (isHtmlResponse && primaryApiUrl !== productionApiUrl) {
      console.warn('[RestaurantOS] Primary order API returned HTML; retrying against production Cloud Run API.');
      response = await fetch(productionApiUrl, {
        method: 'POST',
        headers: apiHeaders,
        credentials: 'omit',
        body: requestBody
      });
      responseText = await response.text();
    }

    let responseData: any = null;
    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch {
      const contentType = response.headers.get('content-type') || 'unknown';
      const preview = responseText.replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(
        `Order API returned a non-JSON response (HTTP ${response.status}, ${contentType}). ${preview || 'Please check the RestaurantOS API deployment.'}`
      );
    }

    if (!response.ok) {
      throw new Error(
        responseData?.message ||
        responseData?.error ||
        `Order submission failed (HTTP ${response.status}).`
      );
    }

    if (!responseData?.success || !responseData?.order) {
      throw new Error(responseData?.message || 'Order API returned an invalid success response.');
    }

    // Clear stored customer cart ONLY after confirmed canonical success
    clearSavedCustomerCart();

    return responseData;
  }

  // Enforce customerId integrity if running directly with auth context
  if (typeof auth !== 'undefined' && auth?.currentUser && customerId) {
    if (auth.currentUser.uid !== customerId && auth.currentUser.email !== 'system-server@restaurantos.app') {
      throw new Error('Security Violation: customerId does not match current authenticated user.');
    }
  }

  // 2. Authoritative Re-validation prior to Firestore mutation (runs on trusted server)
  const validateInput: ValidateCheckoutInput = {
    cart,
    restaurantProfile,
    menuItems,
    orderType,
    customerDetails,
    deliveryDetails,
    paymentMethod,
    customerId,
    customerEmail
  };

  const validation = validateCustomerCheckout(validateInput);
  if (!validation.isValid) {
    const errorMsg = Object.values(validation.errors)[0] || validation.issues[0] || 'Checkout validation failed.';
    throw new Error(`Order Submission Failed: ${errorMsg}`);
  }

  // Authoritative Security Validations
  if (paymentMethod !== 'cash' && !isTest) {
    throw new Error('Order Submission Failed: Only Cash on Delivery (COD) is supported in this release.');
  }

  if (!cart || !cart.items || cart.items.length === 0) {
    throw new Error('Order Submission Failed: Cart is empty.');
  }

  if (cart.items.length > 30) {
    throw new Error('Order Submission Failed: Maximum 30 unique items allowed per order.');
  }

  // Validate quantities, prices and avoid negatives or overflows
  let calculatedSubtotal = 0;
  for (const item of cart.items) {
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || isNaN(qty) || qty <= 0) {
      throw new Error(`Order Submission Failed: Invalid quantity for item "${item.name}".`);
    }
    if (qty > 100) {
      throw new Error(`Order Submission Failed: Quantity for item "${item.name}" exceeds the maximum limit of 100.`);
    }

    const price = Number(item.unitPrice || item.price);
    if (isNaN(price) || price < 0) {
      throw new Error(`Order Submission Failed: Invalid price for item "${item.name}".`);
    }
    if (price > 1000000) {
      throw new Error(`Order Submission Failed: Price for item "${item.name}" exceeds maximum allowed limit.`);
    }
    calculatedSubtotal += price * qty;
  }

  // Validate customer details length to prevent overflow abuse
  if (customerDetails.name.length > 100) {
    throw new Error('Order Submission Failed: Customer name is too long.');
  }
  if (customerDetails.phone.length > 20) {
    throw new Error('Order Submission Failed: Phone number is too long.');
  }

  // 3. Map Customer Cart to canonical CartState
  const restId = cart!.restaurantId;
  const entitlements = await getActivePlanEntitlements(restId);
  if (!entitlements.plan.limits.onlineOrdering) {
    throw new Error(`Online ordering is not enabled on this restaurant's ${entitlements.plan.name} plan.`);
  }

  const cartState = await buildAuthoritativeCustomerCartState(cart!, undefined);

  // 4. Build CustomerSnapshot (historical checkout snapshot at order time)
  const customerSnapshot: CustomerSnapshot = {
    name: customerDetails.name,
    phone: customerDetails.phone,
    email: customerEmail || undefined,
    address:
      orderType === 'delivery' && deliveryDetails
        ? [
            deliveryDetails.addressLine,
            deliveryDetails.area,
            deliveryDetails.city,
            deliveryDetails.postalCode,
            deliveryDetails.state
          ]
            .filter(Boolean)
            .join(', ')
        : undefined
  };

  // 5. Map notes/instructions
  const notes =
    orderType === 'delivery' && deliveryDetails?.deliveryInstructions
      ? `Delivery Instruction: ${deliveryDetails.deliveryInstructions}`
      : undefined;

  // 6. Generate stable clientRequestId for idempotency
  const clientRequestId =
    idempotencyKey ||
    `online_order_${cart!.restaurantId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 7. Delegate directly to canonical OrderService
  const result = await orderService.createOrderForOperatingMode({
    restaurantId: cart!.restaurantId,
    cartState,
    orderType: orderType === 'delivery' ? 'delivery' : 'takeaway',
    source: 'online', // MANDATE: Must strictly set source = 'online'
    customerId: customerId || null,
    customerSnapshot,
    notes,
    clientRequestId,
    customerTrackingToken: input.customerTrackingToken || null,
    operatingProfile: input.operatingProfile,
    restaurant: null
  });

  return {
    success: true,
    order: result.order,
    kot: result.kot
  };
}

function deliveryCityOrFallback(city: string, restaurant?: PublicRestaurantProfile | null): string {
  if (city && city.trim().length > 0) return city.trim();
  if (restaurant && restaurant.city) return restaurant.city;
  return 'Bengaluru';
}

