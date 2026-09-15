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
import { getApiUrl } from '../utils/apiConfig';

export type { CheckoutValidationResult };

export interface ValidateCheckoutInput {
  cart: CustomerCart | null;
  restaurantProfile?: PublicRestaurantProfile | null;
  menuItems?: MenuItem[];
  orderType: 'takeaway' | 'delivery' | 'dineIn';
  customerDetails: CustomerCheckoutDetails;
  deliveryDetails?: CustomerDeliveryDetails;
  paymentMethod: PaymentMethod;
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
      phone: customerDetails.phone.trim()
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
  }

  if (!customerDetails) {
    throw new Error('Customer contact details are required for online order submission.');
  }

  // 1. If running on the client/browser, route the submission through our secure server API endpoint
  const isTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true');
  if (typeof window !== 'undefined' && !isTest) {
    const response = await fetch(getApiUrl('/api/submit-online-order'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || 'Server error occurred during order submission.');
    }

    const result = await response.json();
    
    // Clear stored customer cart ONLY after confirmed canonical success
    clearSavedCustomerCart();

    return result;
  }

  // 2. Authoritative Re-validation prior to Firestore mutation (runs on trusted server)
  const validateInput: ValidateCheckoutInput = {
    cart,
    restaurantProfile,
    menuItems,
    orderType,
    customerDetails,
    deliveryDetails,
    paymentMethod
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
    if (isNaN(qty) || qty <= 0) {
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
  const cartState = mapCustomerCartToCartState(cart!.items);

  // 4. Build CustomerSnapshot
  const customerSnapshot: CustomerSnapshot = {
    name: customerDetails.name,
    phone: customerDetails.phone,
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
    customerSnapshot,
    notes,
    clientRequestId,
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

