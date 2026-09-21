/**
 * Server-only online order pipeline.
 *
 * Browser customer checkout is intentionally persisted through the Firebase Admin SDK
 * on Cloud Run. This avoids depending on a Firebase JS auth session on the backend,
 * which can be absent when Firebase Identity Toolkit/custom-token sign-in is unavailable.
 *
 * Security invariants:
 * - restaurantId is always explicit and tenant-scoped.
 * - catalog price/tax/availability is re-read from Firestore.
 * - subscription/trial access is checked server-side.
 * - order + KOT + idempotency are authoritative server writes.
 * - duplicate submissions are suppressed by an Admin SDK transaction.
 * - guest customers remain supported; no customer Firebase UID is fabricated.
 */

import { randomBytes } from 'node:crypto';
import type {
  CustomerCart,
  CustomerCartItem,
  CustomerCheckoutDetails,
  CustomerDeliveryDetails,
  PublicRestaurantProfile,
  PaymentMethod
} from '../types/customer';
import type { CartItem, CartState } from '../types/cart';
import type { Order, OrderItem, OrderItemModifier, CustomerSnapshot } from '../types/order';
import type { KOT, KOTItem } from '../types/kot';
import type { Restaurant } from '../types/restaurant';
import type { Recipe, StockConsumption } from '../types/recipe';
import type { InventoryItem, StockMovement } from '../types/inventory';
import { adminDb, SYSTEM_SERVER_UID } from './firebaseAdmin';
import { getPlanById, TRIAL_PLAN_ID } from '../config/subscriptionPlans';
import { getRestaurantOperatingProfile } from '../config/restaurantOperatingModes';
import { calculateOrderTotals } from '../services/orderCalculationService';
import { validateOrder } from '../utils/transactionValidation';
import { createRequestSignature } from '../services/idempotencyService';
import { areUnitsCompatible, convertQuantity, roundQuantity } from '../utils/units';
import { randomUUID } from 'node:crypto';

export interface ServerOnlineOrderInput {
  intent?: {
    restaurantId: string;
    restaurantName?: string;
    orderType: 'takeaway' | 'delivery' | 'dineIn';
    customerDetails: CustomerCheckoutDetails;
    deliveryDetails?: CustomerDeliveryDetails;
    customerId?: string | null;
    customerEmail?: string | null;
    items: CustomerCartItem[];
    subtotal: number;
    paymentMethod: PaymentMethod;
    idempotencyKey: string;
    createdAt?: string;
  } | null;
  cart: CustomerCart;
  restaurantProfile?: PublicRestaurantProfile | null;
  orderType: 'takeaway' | 'delivery' | 'dineIn';
  customerDetails: CustomerCheckoutDetails;
  deliveryDetails?: CustomerDeliveryDetails;
  paymentMethod: PaymentMethod;
  idempotencyKey?: string;
  customerId?: string | null;
  customerEmail?: string | null;
  customerTrackingToken?: string | null;
}

export interface ServerOnlineOrderResult {
  success: true;
  order: Order;
  kot: KOT | null;
}

interface PreparedCart {
  cartState: CartState;
  customerSnapshot: CustomerSnapshot;
  notes?: string;
}

function cleanId(value: unknown, fieldName: string): string {
  const valueAsString = typeof value === 'string' ? value.trim() : '';
  if (!valueAsString || valueAsString.includes('/') || valueAsString.includes('\\') || valueAsString.includes('..')) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return valueAsString;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value as Record<string, any>)) {
      if (item !== undefined) result[key] = stripUndefined(item);
    }
    return result as T;
  }
  return value;
}
function asMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  return 0;
}

function buildSnapshotAndCart(
  restaurantId: string,
  cart: CustomerCart,
  customerDetails: CustomerCheckoutDetails,
  deliveryDetails: CustomerDeliveryDetails | undefined,
  customerEmail: string | undefined,
  catalogItems: Map<string, any>
): PreparedCart {
  const canonicalItems: CartItem[] = [];

  if (!Array.isArray(cart.items) || cart.items.length === 0) {
    throw new Error('Cart is empty.');
  }
  if (cart.items.length > 30) {
    throw new Error('Maximum 30 unique items allowed per order.');
  }

  for (const clientItem of cart.items) {
    const itemId = cleanId(clientItem.itemId, 'itemId');
    const data = catalogItems.get(itemId);
    if (!data) {
      throw new Error(`Item "${clientItem.name || itemId}" is no longer available.`);
    }
    if (data.restaurantId && String(data.restaurantId) !== restaurantId) {
      throw new Error('Item tenant mismatch.');
    }
    if (data.itemId && String(data.itemId) !== itemId) {
      throw new Error(`Menu item identity mismatch for "${itemId}".`);
    }
    if (data.isActive === false || data.isAvailable === false) {
      throw new Error(`"${data.name || clientItem.name || itemId}" is no longer available.`);
    }

    const quantity = Number(clientItem.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error(`Invalid quantity for item "${data.name || clientItem.name || itemId}".`);
    }

    const catalogPrice = Number(data.price);
    const taxRate = Number(data.taxRate);
    if (!Number.isFinite(catalogPrice) || catalogPrice < 0 || catalogPrice > 10000000) {
      throw new Error(`Invalid price for "${data.name || clientItem.name || itemId}".`);
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      throw new Error(`Invalid tax rate for "${data.name || clientItem.name || itemId}".`);
    }

    let unitPriceMinor = Math.round(catalogPrice * 100);
    let variantId: string | undefined;
    let variantName: string | undefined;

    if (clientItem.selectedVariantId || clientItem.selectedVariantName) {
      const variants = Array.isArray(data.variants) ? data.variants : [];
      const selectedVariant = variants.find((variant: any) =>
        (clientItem.selectedVariantId && variant.id === clientItem.selectedVariantId)
        || (!clientItem.selectedVariantId && clientItem.selectedVariantName && variant.name === clientItem.selectedVariantName)
      );
      if (!selectedVariant || selectedVariant.isAvailable === false) {
        throw new Error(`Selected option for "${data.name || clientItem.name || itemId}" is unavailable.`);
      }
      const variantPrice = Number(selectedVariant.price);
      if (!Number.isFinite(variantPrice) || variantPrice < 0 || variantPrice > 10000000) {
        throw new Error(`Invalid selected option price for "${data.name || clientItem.name || itemId}".`);
      }
      unitPriceMinor = Math.round(variantPrice * 100);
      variantId = String(selectedVariant.id);
      variantName = String(selectedVariant.name);
    }

    const selectedAddons = Array.isArray(clientItem.selectedAddons) ? clientItem.selectedAddons : [];
    const sourceAddons = Array.isArray(data.addons)
      ? data.addons
      : (Array.isArray(data.addOns) ? data.addOns : []);
    const modifiers: OrderItemModifier[] = [];

    if (variantId && variantName) {
      modifiers.push({
        id: variantId,
        name: `Option: ${variantName}`,
        priceMinor: 0
      });
    }

    for (const clientAddon of selectedAddons) {
      const addon = sourceAddons.find((candidate: any) => candidate.id === clientAddon.addonId);
      if (!addon || addon.isAvailable === false) {
        throw new Error(`Selected add-on for "${data.name || clientItem.name || itemId}" is unavailable.`);
      }
      const addonPrice = Number(addon.price);
      if (!Number.isFinite(addonPrice) || addonPrice < 0 || addonPrice > 10000000) {
        throw new Error(`Invalid selected add-on price for "${data.name || clientItem.name || itemId}".`);
      }
      modifiers.push({
        id: String(addon.id),
        name: String(addon.name),
        priceMinor: Math.round(addonPrice * 100)
      });
    }

    canonicalItems.push({
      cartItemId: String(clientItem.cartItemId || `cart-item-${randomUUID()}`),
      itemId,
      nameSnapshot: String(data.name || clientItem.name || itemId),
      shortNameSnapshot: String(data.shortName || data.name || clientItem.name || itemId),
      imageUrlSnapshot: data.imageUrl || null,
      foodTypeSnapshot: data.foodType || null,
      unitPriceMinor,
      taxRate,
      taxInclusive: Boolean(data.taxInclusive),
      quantity,
      notes: typeof clientItem.itemNotes === 'string' ? clientItem.itemNotes : '',
      modifiers: modifiers.length > 0 ? modifiers : undefined
    });
  }

  const customerSnapshot: CustomerSnapshot = {
    name: customerDetails.name.trim(),
    phone: customerDetails.phone.trim(),
    email: customerEmail || undefined,
    address:
      deliveryDetails
        ? [deliveryDetails.addressLine, deliveryDetails.area, deliveryDetails.city, deliveryDetails.postalCode, deliveryDetails.state]
            .filter(Boolean)
            .join(', ')
        : undefined
  };

  const notes = deliveryDetails?.deliveryInstructions
    ? `Delivery Instruction: ${deliveryDetails.deliveryInstructions}`
    : undefined;

  return {
    cartState: { items: canonicalItems, notes },
    customerSnapshot,
    notes
  };
}

async function loadCatalogItems(restaurantId: string, cart: CustomerCart): Promise<Map<string, any>> {
  const ids = Array.from(new Set(cart.items.map((item) => cleanId(item.itemId, 'itemId'))));
  const entries = await Promise.all(ids.map(async (itemId) => {
    const snap = await adminDb.doc(`restaurants/${restaurantId}/items/${itemId}`).get();
    return [itemId, snap] as const;
  }));

  const result = new Map<string, any>();
  for (const [itemId, snap] of entries) {
    if (snap.exists) result.set(itemId, snap.data());
  }
  return result;
}

async function assertRestaurantAndEntitlement(restaurantId: string, orderType: 'takeaway' | 'delivery' | 'dineIn'): Promise<Restaurant> {
  const [restaurantSnap, publicSnap, subscriptionSnap] = await Promise.all([
    adminDb.doc(`restaurants/${restaurantId}`).get(),
    adminDb.doc(`publicRestaurants/${restaurantId}`).get(),
    adminDb.doc(`restaurants/${restaurantId}/subscription/current`).get()
  ]);

  if (!restaurantSnap.exists) {
    throw new Error('Restaurant does not exist.');
  }
  if (!publicSnap.exists) {
    throw new Error('Online ordering is temporarily unavailable for this restaurant.');
  }

  const restaurant = restaurantSnap.data() as Restaurant;
  const profile = publicSnap.data() as any;

  if (profile.publicStatus === 'closed' || profile.publicStatus === 'paused') {
    throw new Error('Restaurant is currently not accepting orders.');
  }
  if (!profile.onlineOrderingEnabled) {
    throw new Error('Online ordering is currently disabled for this restaurant.');
  }
  if (orderType === 'delivery' && profile.deliveryEnabled === false) {
    throw new Error('Delivery is not available for this restaurant.');
  }
  if (orderType === 'takeaway' && profile.takeawayEnabled === false) {
    throw new Error('Takeaway is not available for this restaurant.');
  }
  if (orderType === 'dineIn') {
    throw new Error('Dine-in ordering is not available via online customer checkout.');
  }

  if (!subscriptionSnap.exists) {
    throw new Error('Online ordering requires an active subscription or trial.');
  }

  const sub = subscriptionSnap.data() as any;
  const accessUntil = asMillis(sub.operationalAccessUntil);
  if (!['trial', 'active', 'grace_period'].includes(String(sub.status)) || !accessUntil || Date.now() >= accessUntil) {
    throw new Error('Online ordering is unavailable because the restaurant subscription or trial has expired.');
  }

  const plan = getPlanById(String(sub.planId || TRIAL_PLAN_ID));
  if (!plan.limits.onlineOrdering) {
    throw new Error(`Online ordering is not enabled on the ${plan.name} plan.`);
  }

  return restaurant;
}

function prepareOrder(
  restaurantId: string,
  cartState: CartState,
  orderType: 'takeaway' | 'delivery',
  sourceCustomerId: string | null,
  customerSnapshot: CustomerSnapshot,
  notes: string | undefined,
  trackingToken: string | null,
  createKot: boolean
): { order: Order; kot: KOT | null } {
  const taxJurisdiction = 'intraState' as const;
  const calculations = calculateOrderTotals({
    items: cartState.items.map((item) => ({
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      taxRate: item.taxRate,
      taxInclusive: item.taxInclusive,
      discount: item.discount
    })),
    orderDiscount: cartState.orderDiscount,
    taxJurisdiction
  });

  const now = new Date();
  const orderCol = adminDb.collection(`restaurants/${restaurantId}/orders`);
  const orderRef = orderCol.doc();
  const kotRef = adminDb.collection(`restaurants/${restaurantId}/kots`).doc();
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const kotNumber = `KOT-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
  const createdBy = sourceCustomerId || SYSTEM_SERVER_UID;
  const status = createKot ? 'sentToKitchen' : 'confirmed';

  const items: OrderItem[] = cartState.items.map((item, index) => {
    const line = calculations.lineResults[index];
    return {
      itemId: item.itemId,
      nameSnapshot: item.nameSnapshot,
      shortNameSnapshot: item.shortNameSnapshot,
      imageUrlSnapshot: item.imageUrlSnapshot || null,
      foodTypeSnapshot: item.foodTypeSnapshot || null,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      taxRate: item.taxRate,
      taxInclusive: item.taxInclusive,
      discountMinor: line.discountMinor,
      lineSubtotalMinor: line.subtotalMinor,
      lineTaxMinor: line.totalTaxMinor,
      lineTotalMinor: line.lineTotalMinor,
      notes: item.notes,
      modifiers: item.modifiers ? [...item.modifiers] : undefined
    };
  });

  const orderPayload: Omit<Order, 'id' | 'createdAt' | 'updatedAt'> = {
    restaurantId,
    orderNumber,
    customerId: sourceCustomerId,
    orderType,
    source: 'online',
    status,
    tableId: null,
    tableSessionId: null,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalMinor: calculations.subtotalMinor,
    discountMinor: calculations.discountMinor,
    taxableAmountMinor: calculations.taxableAmountMinor,
    cgstMinor: calculations.cgstMinor,
    sgstMinor: calculations.sgstMinor,
    igstMinor: calculations.igstMinor,
    totalTaxMinor: calculations.totalTaxMinor,
    grandTotalMinor: calculations.grandTotalMinor,
    paidAmountMinor: 0,
    dueAmountMinor: calculations.grandTotalMinor,
    paymentStatus: 'unpaid',
    notes: notes || cartState.notes,
    customerSnapshot,
    customerTrackingToken: sourceCustomerId ? null : trackingToken,
    createdBy,
    updatedBy: createdBy
  };

  const validation = validateOrder(orderPayload, { skipTableRequirement: true });
  if (!validation.isValid) {
    throw new Error(`Order validation failed: ${validation.error || 'Invalid order data'}`);
  }

  const kotItems: KOTItem[] = items.map((item) => ({
    itemId: item.itemId,
    nameSnapshot: item.nameSnapshot,
    shortNameSnapshot: item.shortNameSnapshot,
    imageUrlSnapshot: item.imageUrlSnapshot || null,
    foodTypeSnapshot: item.foodTypeSnapshot || null,
    quantity: item.quantity,
    notes: item.notes,
    modifiers: item.modifiers ? [...item.modifiers] : undefined
  }));

  const kotPayload: KOT = {
    id: kotRef.id,
    kotNumber,
    restaurantId,
    orderId: orderRef.id,
    orderNumber,
    orderType,
    tableId: null,
    tableSessionId: null,
    items: kotItems,
    notes: notes || cartState.notes || '',
    status: 'sentToKitchen',
    sentToKitchenAt: now,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now
  };

  const order: Order = {
    id: orderRef.id,
    ...orderPayload,
    createdAt: now,
    updatedAt: now
  };

  return { order, kot: createKot ? kotPayload : null };
}

async function consumeStockForOrder(
  restaurantId: string,
  order: Order,
  actorUid: string,
  clientRequestId: string
): Promise<{ consumptions: StockConsumption[]; movements: StockMovement[] }> {
  const items = order.items.map((item, index) => ({
    itemId: item.itemId,
    quantity: item.quantity,
    orderItemId: `item_${index}_${item.itemId}`,
    nameSnapshot: item.nameSnapshot
  }));

  if (!items.length) return { consumptions: [], movements: [] };

  const recipeSnapshots = await Promise.all(Array.from(new Set(items.map((i) => i.itemId))).map(async (menuItemId) => {
    const snap = await adminDb.collection(`restaurants/${restaurantId}/recipes`)
      .where('menuItemId', '==', menuItemId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    const recipeDoc = snap.docs[0];
    return recipeDoc ? { menuItemId, recipe: { id: recipeDoc.id, ...recipeDoc.data() } as Recipe } : null;
  }));

  const activeRecipes = new Map<string, Recipe>();
  for (const result of recipeSnapshots) if (result) activeRecipes.set(result.menuItemId, result.recipe);

  if (!items.some((item) => activeRecipes.has(item.itemId))) {
    await adminDb.doc(`restaurants/${restaurantId}/order_stock_locks/${order.id}`).set(stripUndefined({
      restaurantId,
      orderId: order.id,
      status: 'not_applicable',
      actorUid,
      actorType: 'server',
      idempotencyKey: clientRequestId,
      createdAt: new Date(),
      updatedAt: new Date()
    }), { merge: true });
    return { consumptions: [], movements: [] };
  }

  const result = await adminDb.runTransaction(async (tx) => {
    const lockRef = adminDb.doc(`restaurants/${restaurantId}/order_stock_locks/${order.id}`);
    const lockSnap = await tx.get(lockRef);
    if (lockSnap.exists && ['consumed', 'not_applicable'].includes(String(lockSnap.data()?.status))) {
      return { consumptions: [], movements: [] };
    }

    const requiredByInventory = new Map<string, number>();
    const plans: Array<{
      orderItem: (typeof items)[number];
      recipe: Recipe;
      ingredient: Recipe['ingredients'][number];
      inventoryItem: InventoryItem;
      requiredBaseQty: number;
    }> = [];

    const inventoryIds = new Set<string>();
    for (const item of items) {
      const recipe = activeRecipes.get(item.itemId);
      if (!recipe) continue;
      for (const ingredient of recipe.ingredients) {
        const id = String(ingredient.inventoryItemId).trim();
        if (id) inventoryIds.add(id);
      }
    }

    const inventoryMap = new Map<string, InventoryItem>();
    for (const invId of inventoryIds) {
      const invRef = adminDb.doc(`restaurants/${restaurantId}/inventoryItems/${invId}`);
      const invSnap = await tx.get(invRef);
      if (!invSnap.exists) throw new Error(`Inventory item "${invId}" referenced by recipe does not exist.`);
      const inventory = invSnap.data() as InventoryItem;
      if (inventory.restaurantId !== restaurantId) throw new Error(`Inventory item "${invId}" belongs to a different restaurant.`);
      if (!inventory.active || inventory.status === 'archived') throw new Error(`Inventory item "${inventory.name}" is inactive.`);
      inventoryMap.set(invId, inventory);
    }

    for (const item of items) {
      const recipe = activeRecipes.get(item.itemId);
      if (!recipe) continue;
      for (const ingredient of recipe.ingredients) {
        const inventory = inventoryMap.get(String(ingredient.inventoryItemId).trim());
        if (!inventory) continue;
        if (!areUnitsCompatible(ingredient.unit, inventory.unit)) {
          throw new Error(`Unit mismatch for "${inventory.name}": Recipe unit "${ingredient.unit}" cannot be converted to inventory base unit "${inventory.unit}".`);
        }
        const perDish = convertQuantity(Number(ingredient.quantity), ingredient.unit, inventory.unit);
        const required = roundQuantity(perDish * item.quantity);
        const current = requiredByInventory.get(inventory.id) || 0;
        requiredByInventory.set(inventory.id, roundQuantity(current + required));
        plans.push({ orderItem: item, recipe, ingredient, inventoryItem: inventory, requiredBaseQty: required });
      }
    }

    for (const [inventoryId, requiredQty] of requiredByInventory) {
      const inventory = inventoryMap.get(inventoryId)!;
      if (inventory.currentQuantity < requiredQty) {
        const shortage = roundQuantity(requiredQty - inventory.currentQuantity);
        throw new Error(`Insufficient stock for "${inventory.name}": required ${requiredQty} ${inventory.unit}, but only ${inventory.currentQuantity} ${inventory.unit} available. Shortage: ${shortage} ${inventory.unit}. Consumption rejected.`);
      }
    }

    const movements: StockMovement[] = [];
    const consumptions: StockConsumption[] = [];
    const movementIds = new Map<string, string>();

    for (const [inventoryId, requiredQty] of requiredByInventory) {
      const inventory = inventoryMap.get(inventoryId)!;
      const invRef = adminDb.doc(`restaurants/${restaurantId}/inventoryItems/${inventoryId}`);
      const newQuantity = roundQuantity(inventory.currentQuantity - requiredQty);
      tx.update(invRef, {
        currentQuantity: newQuantity,
        updatedAt: new Date(),
        updatedBy: actorUid
      });

      const movementRef = adminDb.collection(`restaurants/${restaurantId}/stockMovements`).doc();
      const movement: StockMovement = {
        id: movementRef.id,
        movementId: movementRef.id,
        restaurantId,
        inventoryItemId: inventoryId,
        type: 'stock_out',
        quantity: requiredQty,
        unit: inventory.unit,
        delta: -requiredQty,
        previousQuantity: inventory.currentQuantity,
        resultingQuantity: newQuantity,
        reason: `Recipe stock consumption for order #${order.orderNumber}`,
        actorUid,
        clientRequestId,
        referenceType: 'order',
        referenceId: order.id,
        createdAt: new Date()
      };
      tx.set(movementRef, movement);
      movements.push(movement);
      movementIds.set(inventoryId, movementRef.id);
    }

    for (const plan of plans) {
      const consumptionRef = adminDb.collection(`restaurants/${restaurantId}/stockConsumptions`).doc();
      const movementId = movementIds.get(plan.inventoryItem.id)!;
      const consumption: StockConsumption = {
        id: consumptionRef.id,
        consumptionId: consumptionRef.id,
        restaurantId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderItemId: plan.orderItem.orderItemId,
        menuItemId: plan.orderItem.itemId,
        menuItemNameSnapshot: plan.orderItem.nameSnapshot,
        recipeId: plan.recipe.id,
        recipeVersion: plan.recipe.version,
        inventoryItemId: plan.inventoryItem.id,
        inventoryItemNameSnapshot: plan.inventoryItem.name,
        quantity: plan.requiredBaseQty,
        unit: plan.inventoryItem.unit,
        recipeQuantity: plan.ingredient.quantity,
        recipeUnit: plan.ingredient.unit,
        orderItemQuantity: plan.orderItem.quantity,
        delta: -plan.requiredBaseQty,
        stockMovementId: movementId,
        actorUid,
        clientRequestId,
        idempotencyKey: clientRequestId,
        status: 'consumed',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      tx.set(consumptionRef, consumption);
      consumptions.push(consumption);
    }

    tx.set(adminDb.doc(`restaurants/${restaurantId}/order_stock_locks/${order.id}`), {
      restaurantId,
      orderId: order.id,
      status: 'consumed',
      consumedAt: new Date(),
      actorUid,
      actorType: 'server',
      idempotencyKey: clientRequestId
    }, { merge: true });

    return { consumptions, movements };
  });

  return result;
}

async function writeAudit(
  restaurantId: string,
  entityType: 'order' | 'kot' | 'inventory',
  entityId: string,
  action: string,
  actorUid: string,
  metadata: Record<string, any>
): Promise<void> {
  try {
    const ref = adminDb.collection(`restaurants/${restaurantId}/auditLogs`).doc();
    await ref.set({
      id: ref.id,
      restaurantId,
      entityType,
      entityId,
      action,
      actorUid,
      metadata,
      createdAt: new Date()
    });
  } catch (error) {
    console.warn('[RestaurantOS Server] Online order audit write skipped:', error);
  }
}

function extractInput(input: ServerOnlineOrderInput) {
  if (!input.cart) throw new Error('Cart is empty.');
  if (!input.customerDetails?.name || input.customerDetails.name.trim().length < 2) throw new Error('Customer name is required.');
  if (!input.customerDetails?.phone || !/\\d{10,15}/.test(input.customerDetails.phone.replace(/\\D/g, ''))) {
    throw new Error('A valid customer phone number is required.');
  }
  if (!['cash'].includes(input.paymentMethod)) {
    throw new Error('Only Cash on Delivery (COD) is supported in this release.');
  }

  const restaurantId = cleanId(input.cart.restaurantId, 'restaurantId');
  const orderType = input.orderType || 'takeaway';
  const key = cleanId(
    input.idempotencyKey
    || input.intent?.idempotencyKey
    || `online_order_${restaurantId}_${Date.now()}_${randomBytes(5).toString('hex')}`,
    'idempotencyKey'
  );

  return {
    restaurantId,
    orderType: orderType as 'takeaway' | 'delivery',
    key,
    customerId: input.customerId?.trim() || null,
    customerEmail: input.customerEmail?.trim() || input.intent?.customerEmail?.trim() || input.customerDetails.email?.trim() || undefined
  };
}

/**
 * Main server-authoritative online checkout.
 */
export async function submitServerOnlineOrder(input: ServerOnlineOrderInput): Promise<ServerOnlineOrderResult> {
  const { restaurantId, orderType, key, customerId, customerEmail } = extractInput(input);

  if (customerId && !/^[A-Za-z0-9_-]{10,256}$/.test(customerId)) {
    throw new Error('Invalid customer identity.');
  }

  const restaurant = await assertRestaurantAndEntitlement(restaurantId, orderType);
  const catalog = await loadCatalogItems(restaurantId, input.cart);
  const prepared = buildSnapshotAndCart(
    restaurantId,
    input.cart,
    input.customerDetails,
    input.deliveryDetails,
    customerEmail,
    catalog
  );

  const profile = getRestaurantOperatingProfile(restaurant);
  const createKot = profile.capabilities.kitchenEnabled;

  const signaturePayload = {
    restaurantId,
    orderType,
    customerId,
    cartState: prepared.cartState,
    customerSnapshot: prepared.customerSnapshot,
    paymentMethod: input.paymentMethod
  };
  const requestSignature = createRequestSignature(signaturePayload);
  const idempotencyRef = adminDb.doc(`restaurants/${restaurantId}/idempotency/${key}`);

  const acquired = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(idempotencyRef);
    if (snap.exists) {
      const record = snap.data() || {};
      if (record.restaurantId !== restaurantId) throw new Error('Cross-tenant idempotency violation.');
      if (record.operation !== 'create_order_with_kot' && record.operation !== 'create_order') {
        throw new Error('Idempotency operation mismatch.');
      }
      if (record.requestSignature !== requestSignature) {
        throw new Error('Idempotency payload divergence: this key was already used with different order data.');
      }
      if (record.status === 'completed' && record.responseSnapshot) {
        return { action: 'cached' as const, result: record.responseSnapshot as { order: Order; kot: KOT | null } };
      }
      if (record.status === 'pending') {
        const lockedAt = asMillis(record.lockedAt);
        if (lockedAt && Date.now() - lockedAt < 15 * 60 * 1000) {
          return { action: 'in_flight' as const };
        }
      }
    }

    tx.set(idempotencyRef, stripUndefined({
      id: key,
      restaurantId,
      operation: createKot ? 'create_order_with_kot' : 'create_order',
      requestSignature,
      status: 'pending',
      targetEntityId: null,
      responseSnapshot: null,
      errorMessage: null,
      createdBy: SYSTEM_SERVER_UID,
      actorUid: customerId || SYSTEM_SERVER_UID,
      lockedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }), { merge: false });

    return { action: 'execute' as const };
  });

  if (acquired.action === 'cached') {
    return { success: true, order: acquired.result.order as Order, kot: (acquired.result.kot as KOT | null) || null };
  }
  if (acquired.action === 'in_flight') {
    throw new Error('An identical online order submission is already being processed. Please wait a moment and retry.');
  }

  const { order, kot } = prepareOrder(
    restaurantId,
    prepared.cartState,
    orderType,
    customerId,
    prepared.customerSnapshot,
    prepared.notes,
    input.customerTrackingToken || (customerId ? null : randomBytes(32).toString('base64url')),
    createKot
  );

  try {
    await adminDb.runTransaction(async (tx) => {
      const orderRef = adminDb.doc(`restaurants/${restaurantId}/orders/${order.id}`);
      tx.create(orderRef, stripUndefined({
        ...order,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      if (kot) {
        const kotRef = adminDb.doc(`restaurants/${restaurantId}/kots/${kot.id}`);
        tx.create(kotRef, stripUndefined({
          ...kot,
          sentToKitchenAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }));
      }

      tx.update(idempotencyRef, {
        status: 'completed',
        targetEntityId: order.id,
        responseSnapshot: stripUndefined({ order, kot }),
        updatedAt: new Date()
      });
    });

    await writeAudit(restaurantId, 'order', order.id, 'order_created', order.createdBy, {
      orderNumber: order.orderNumber,
      grandTotalMinor: order.grandTotalMinor,
      orderType: order.orderType,
      kotId: kot?.id || null,
      kotNumber: kot?.kotNumber || null
    });

    if (kot) {
      await writeAudit(restaurantId, 'kot', kot.id, 'kot_created', kot.createdBy, {
        kotNumber: kot.kotNumber,
        orderId: order.id,
        status: kot.status,
        itemCount: kot.items.length
      });
    }

    // Inventory deduction is best-effort exactly like the canonical OrderService:
    // order creation itself remains successful when stock is unavailable or unmapped.
    try {
      const stockResult = await consumeStockForOrder(restaurantId, order, order.createdBy || SYSTEM_SERVER_UID, key);
      const orderRef = adminDb.doc(`restaurants/${restaurantId}/orders/${order.id}`);
      await orderRef.update(stripUndefined({
        stockConsumptionStatus: stockResult.consumptions.length ? 'consumed' : 'not_applicable',
        stockConsumptionError: null,
        updatedAt: new Date()
      }));
      order.stockConsumptionStatus = stockResult.consumptions.length ? 'consumed' : 'not_applicable';
      order.stockConsumptionError = null;
      if (stockResult.consumptions.length) {
        await writeAudit(restaurantId, 'inventory', order.id, 'stock_consumption_recorded', order.createdBy || SYSTEM_SERVER_UID, {
          orderId: order.id,
          orderNumber: order.orderNumber,
          consumptionsCount: stockResult.consumptions.length,
          movementsCount: stockResult.movements.length
        });
      }
    } catch (stockError: any) {
      const message = String(stockError?.message || 'Stock consumption failed.');
      order.stockConsumptionStatus = 'failed';
      order.stockConsumptionError = message;
      try {
        await adminDb.doc(`restaurants/${restaurantId}/orders/${order.id}`).update(stripUndefined({
          stockConsumptionStatus: 'failed',
          stockConsumptionError: message,
          updatedAt: new Date()
        }));
      } catch (statusError) {
        console.warn('[RestaurantOS Server] Could not persist online order stock failure state:', statusError);
      }
    }

    return { success: true, order, kot };
  } catch (error) {
    try {
      await idempotencyRef.update({
        status: 'failed',
        errorMessage: String((error as any)?.message || 'Failed to create online order').slice(0, 500),
        updatedAt: new Date()
      });
    } catch (idempotencyError) {
      console.warn('[RestaurantOS Server] Could not persist online order idempotency failure:', idempotencyError);
    }
    throw error;
  }
}


/** Server-authoritative POS order creation. The HTTP route verifies the caller role; all Firestore mutations use Admin SDK. */
export async function submitServerPosOrder(input: {
  restaurantId: string;
  cartState: CartState;
  orderType: 'dineIn' | 'takeaway' | 'delivery';
  source: string;
  tableId?: string | null;
  tableSessionId?: string | null;
  customerSnapshot?: CustomerSnapshot | null;
  notes?: string;
  taxJurisdiction?: 'intraState' | 'interState';
  createdBy: string;
  clientRequestId?: string;
  skipTableSessionValidation?: boolean;
  createKot?: boolean;
}): Promise<{ order: Order; kot: KOT | null }> {
  const restaurantId = cleanId(input.restaurantId, 'restaurantId');
  const subSnap = await adminDb.doc(\`restaurants/\${restaurantId}/subscription/current\`).get();
  if (!subSnap.exists) throw new Error('Restaurant trial or subscription is not active.');
  const sub = subSnap.data() || {};
  const accessUntil = asMillis(sub.operationalAccessUntil);
  if (!['trial', 'active', 'grace_period'].includes(String(sub.status)) || !accessUntil || Date.now() >= accessUntil) {
    throw new Error('Restaurant trial or subscription has expired.');
  }

  if (input.orderType === 'dineIn' && !input.skipTableSessionValidation) {
    const sessionId = cleanId(input.tableSessionId, 'tableSessionId');
    const sessionSnap = await adminDb.doc(\`restaurants/\${restaurantId}/tableSessions/\${sessionId}\`).get();
    if (!sessionSnap.exists || sessionSnap.data()?.restaurantId !== restaurantId || sessionSnap.data()?.status !== 'open') {
      throw new Error('Selected table session is not open.');
    }
  }

  if (!Array.isArray(input.cartState.items) || input.cartState.items.length === 0) throw new Error('Cart is empty.');

  // Re-read authoritative menu price/tax/availability; client values are not trusted.
  const canonicalItems: CartItem[] = await Promise.all(input.cartState.items.map(async (item) => {
    const itemId = cleanId(item.itemId, 'itemId');
    const snap = await adminDb.doc(\`restaurants/\${restaurantId}/items/\${itemId}\`).get();
    if (!snap.exists) throw new Error(\`Item "\${item.nameSnapshot || itemId}" is no longer available.\`);
    const data = snap.data() as any;
    if (data.restaurantId && data.restaurantId !== restaurantId) throw new Error('Item tenant mismatch.');
    if (data.isActive === false || data.isAvailable === false) throw new Error(\`"\${data.name || item.nameSnapshot || itemId}" is unavailable.\`);
    const price = Number(data.price);
    const taxRate = Number(data.taxRate);
    if (!Number.isFinite(price) || price < 0) throw new Error(\`Invalid price for "\${data.name || itemId}".\`);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error(\`Invalid tax rate for "\${data.name || itemId}".\`);
    return {
      ...item,
      itemId,
      nameSnapshot: String(data.name || item.nameSnapshot || itemId),
      shortNameSnapshot: String(data.shortName || data.name || item.shortNameSnapshot || itemId),
      imageUrlSnapshot: data.imageUrl || item.imageUrlSnapshot || null,
      foodTypeSnapshot: data.foodType || item.foodTypeSnapshot || null,
      unitPriceMinor: Math.round(price * 100),
      taxRate,
      taxInclusive: Boolean(data.taxInclusive),
      quantity: Math.max(1, Math.min(100, Math.floor(Number(item.quantity) || 1)))
    };
  }));

  const calculations = calculateOrderTotals({
    items: canonicalItems.map(item => ({
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      taxRate: item.taxRate,
      taxInclusive: item.taxInclusive,
      discount: item.discount
    })),
    orderDiscount: input.cartState.orderDiscount,
    taxJurisdiction: input.taxJurisdiction || 'intraState'
  });

  const now = new Date();
  const orderRef = adminDb.collection(\`restaurants/\${restaurantId}/orders\`).doc();
  const orderNumber = \`ORD-\${Date.now().toString(36).toUpperCase()}-\${randomBytes(3).toString('hex').toUpperCase()}\`;
  const orderItems: OrderItem[] = calculations.lineResults.map((line: any, index: number) => ({
    itemId: canonicalItems[index].itemId,
    nameSnapshot: canonicalItems[index].nameSnapshot,
    shortNameSnapshot: canonicalItems[index].shortNameSnapshot,
    imageUrlSnapshot: canonicalItems[index].imageUrlSnapshot || null,
    foodTypeSnapshot: canonicalItems[index].foodTypeSnapshot || null,
    quantity: canonicalItems[index].quantity,
    unitPriceMinor: canonicalItems[index].unitPriceMinor,
    taxRate: canonicalItems[index].taxRate,
    taxInclusive: canonicalItems[index].taxInclusive,
    discountMinor: line.discountMinor,
    lineSubtotalMinor: line.subtotalMinor,
    lineTaxMinor: line.totalTaxMinor,
    lineTotalMinor: line.lineTotalMinor,
    notes: canonicalItems[index].notes,
    modifiers: canonicalItems[index].modifiers ? [...canonicalItems[index].modifiers!] : undefined
  }));

  const orderPayload: any = {
    restaurantId,
    orderNumber,
    customerId: null,
    orderType: input.orderType,
    source: input.source,
    status: input.createKot ? 'sentToKitchen' : 'confirmed',
    tableId: input.orderType === 'dineIn' ? (input.tableId || null) : null,
    tableSessionId: input.orderType === 'dineIn' ? (input.tableSessionId || null) : null,
    items: orderItems,
    itemCount: orderItems.reduce((sum, item) => sum + item.quantity, 0),
    subtotalMinor: calculations.subtotalMinor,
    discountMinor: calculations.discountMinor,
    taxableAmountMinor: calculations.taxableAmountMinor,
    cgstMinor: calculations.cgstMinor,
    sgstMinor: calculations.sgstMinor,
    igstMinor: calculations.igstMinor,
    totalTaxMinor: calculations.totalTaxMinor,
    grandTotalMinor: calculations.grandTotalMinor,
    paidAmountMinor: 0,
    dueAmountMinor: calculations.grandTotalMinor,
    paymentStatus: 'unpaid',
    notes: input.notes || input.cartState.notes || '',
    customerSnapshot: input.customerSnapshot || null,
    createdBy: input.createdBy,
    updatedBy: input.createdBy
  };

  const validation = validateOrder(orderPayload, { skipTableRequirement: input.skipTableSessionValidation || !orderPayload.tableId });
  if (!validation.isValid) throw new Error(\`Order validation failed: \${validation.error || 'Invalid order data'}\`);

  const kotRef = input.createKot ? adminDb.collection(\`restaurants/\${restaurantId}/kots\`).doc() : null;
  const kot: KOT | null = kotRef ? ({
    id: kotRef.id,
    kotNumber: \`KOT-\${Date.now().toString(36).toUpperCase()}-\${randomBytes(2).toString('hex').toUpperCase()}\`,
    restaurantId,
    orderId: orderRef.id,
    orderNumber,
    orderType: input.orderType,
    tableId: orderPayload.tableId || null,
    tableSessionId: orderPayload.tableSessionId || null,
    items: orderItems.map(item => ({
      itemId: item.itemId,
      nameSnapshot: item.nameSnapshot,
      shortNameSnapshot: item.shortNameSnapshot,
      imageUrlSnapshot: item.imageUrlSnapshot || null,
      foodTypeSnapshot: item.foodTypeSnapshot || null,
      quantity: item.quantity,
      notes: item.notes,
      modifiers: item.modifiers ? [...item.modifiers] : undefined
    })),
    notes: orderPayload.notes || '',
    status: 'sentToKitchen',
    sentToKitchenAt: now,
    createdBy: input.createdBy,
    updatedBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  } as KOT) : null;

  const idempotencyKey = input.clientRequestId
    ? \`\${input.createdBy}_\${input.clientRequestId}\`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)
    : null;
  const idemRef = idempotencyKey ? adminDb.doc(\`restaurants/\${restaurantId}/idempotency/\${idempotencyKey}\`) : null;
  if (idemRef) {
    const existing = await idemRef.get();
    if (existing.exists && existing.data()?.status === 'completed' && existing.data()?.responseSnapshot) {
      return existing.data()!.responseSnapshot as { order: Order; kot: KOT | null };
    }
  }

  await adminDb.runTransaction(async tx => {
    if (idemRef) {
      const current = await tx.get(idemRef);
      if (current.exists && current.data()?.status === 'completed') return;
      tx.set(idemRef, {
        id: idempotencyKey,
        restaurantId,
        operation: 'create_order_with_kot',
        status: 'pending',
        createdBy: SYSTEM_SERVER_UID,
        actorUid: input.createdBy,
        createdAt: now,
        updatedAt: now
      }, { merge: false });
    }
    tx.create(orderRef, stripUndefined({ ...orderPayload, id: orderRef.id, createdAt: now, updatedAt: now }));
    if (kotRef && kot) tx.create(kotRef, stripUndefined(kot));
  });

  const order = { id: orderRef.id, ...orderPayload, createdAt: now, updatedAt: now } as Order;
  if (idemRef) {
    await idemRef.set({
      status: 'completed',
      targetEntityId: order.id,
      responseSnapshot: { order, kot },
      updatedAt: new Date()
    }, { merge: true });
  }
  await writeAudit(restaurantId, 'order', order.id, 'order_created', input.createdBy, {
    orderNumber: order.orderNumber,
    grandTotalMinor: order.grandTotalMinor,
    orderType: order.orderType,
    kotId: kot?.id || null
  });
  if (kot) await writeAudit(restaurantId, 'kot', kot.id, 'kot_created', input.createdBy, {
    kotNumber: kot.kotNumber,
    orderId: order.id,
    status: kot.status
  });
  return { order, kot };
}
