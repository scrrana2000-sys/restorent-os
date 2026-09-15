import { Restaurant, RestaurantOperatingMode, RestaurantCapabilities } from '../types/restaurant';
import { OrderType } from '../types/order';

/**
 * Canonical default capabilities for Full Service restaurant mode.
 * Preserves 100% of existing RestaurantOS operational behaviors.
 */
export const FULL_SERVICE_CAPABILITIES: Readonly<RestaurantCapabilities> = Object.freeze({
  tablesEnabled: true,
  kitchenEnabled: true,
  captainEnabled: true,
  inventoryEnabled: true,
  deliveryEnabled: true,
  takeawayEnabled: true,
  paymentsEnabled: true
});

/**
 * Canonical default capabilities for Single Person / Small Restaurant mode.
 * Optimized for one-person fast counter billing without KOT or waiter steps.
 */
export const SINGLE_PERSON_CAPABILITIES: Readonly<RestaurantCapabilities> = Object.freeze({
  tablesEnabled: true, // Configurable OFF in Restaurant Setup if takeaway-only
  kitchenEnabled: false,
  captainEnabled: false,
  inventoryEnabled: true,
  deliveryEnabled: true,
  takeawayEnabled: true,
  paymentsEnabled: true
});

/**
 * Canonical default capabilities for Small Team mode.
 * Small team with direct or optional kitchen KOT, without requiring Captain/waiter workflow.
 */
export const SMALL_TEAM_CAPABILITIES: Readonly<RestaurantCapabilities> = Object.freeze({
  tablesEnabled: true,
  kitchenEnabled: true,
  captainEnabled: false,
  inventoryEnabled: true,
  deliveryEnabled: true,
  takeawayEnabled: true,
  paymentsEnabled: true
});

/**
 * Default fallback capabilities when missing in legacy restaurant documents.
 */
export const DEFAULT_CAPABILITIES: Readonly<RestaurantCapabilities> = FULL_SERVICE_CAPABILITIES;

/**
 * Returns default capabilities for a given operating mode.
 */
export function getDefaultCapabilitiesForMode(mode: RestaurantOperatingMode): RestaurantCapabilities {
  switch (mode) {
    case 'single_person':
      return { ...SINGLE_PERSON_CAPABILITIES };
    case 'small_team':
      return { ...SMALL_TEAM_CAPABILITIES };
    case 'full_service':
    case 'custom':
    default:
      return { ...FULL_SERVICE_CAPABILITIES };
  }
}

/**
 * Resolved operating profile returned by the central resolver.
 */
export interface RestaurantOperatingProfile {
  mode: RestaurantOperatingMode;
  capabilities: RestaurantCapabilities;
  navigation: {
    isPosVisible: boolean;
    isCaptainVisible: boolean;
    isKitchenVisible: boolean;
    isOrdersVisible: boolean;
    isPaymentsVisible: boolean;
    isInventoryVisible: boolean;
    isDashboardVisible: boolean;
    isReportsVisible: boolean;
    isAuditVisible: boolean;
    isStaffVisible: boolean;
    isRestaurantVisible: boolean;
    isCategoriesVisible: boolean;
    isItemsVisible: boolean;
  };
  workflow: {
    hasKitchenFlow: boolean;
    hasCaptainFlow: boolean;
    hasTableFlow: boolean;
    directBillAndPay: boolean;
  };
  posBehavior: {
    showTableSelector: boolean;
    showOrderTypeSelector: boolean;
    allowedOrderTypes: OrderType[];
    defaultOrderType: OrderType;
    allowDirectPayment: boolean;
    primaryActionLabel: string;
    requiresKotBeforePayment: boolean;
  };
}

/**
 * Central Operating Model Resolver.
 *
 * Resolves the active mode, sanitized capabilities, navigation flags,
 * workflow indicators, and POS behaviors for a restaurant.
 *
 * BACKWARD COMPATIBILITY INVARIANT:
 * If restaurant is null, undefined, or missing operating fields, it safely
 * falls back to 'full_service' and full-service capabilities.
 */
export function getRestaurantOperatingProfile(
  restaurant?: Restaurant | null
): RestaurantOperatingProfile {
  // 1. Resolve operating mode (Default: 'full_service' for backward compatibility)
  const rawMode = restaurant?.restaurantOperatingMode;
  const mode: RestaurantOperatingMode =
    rawMode === 'single_person' ||
    rawMode === 'small_team' ||
    rawMode === 'full_service' ||
    rawMode === 'custom'
      ? rawMode
      : 'full_service';

  // 2. Resolve capabilities additively
  const defaultCaps = getDefaultCapabilitiesForMode(mode);
  const rawCaps = restaurant?.restaurantCapabilities;

  const capabilities: RestaurantCapabilities = {
    tablesEnabled: typeof rawCaps?.tablesEnabled === 'boolean' ? rawCaps.tablesEnabled : defaultCaps.tablesEnabled,
    kitchenEnabled: typeof rawCaps?.kitchenEnabled === 'boolean' ? rawCaps.kitchenEnabled : defaultCaps.kitchenEnabled,
    captainEnabled: typeof rawCaps?.captainEnabled === 'boolean' ? rawCaps.captainEnabled : defaultCaps.captainEnabled,
    inventoryEnabled: typeof rawCaps?.inventoryEnabled === 'boolean' ? rawCaps.inventoryEnabled : defaultCaps.inventoryEnabled,
    deliveryEnabled: typeof rawCaps?.deliveryEnabled === 'boolean' ? rawCaps.deliveryEnabled : defaultCaps.deliveryEnabled,
    takeawayEnabled: typeof rawCaps?.takeawayEnabled === 'boolean' ? rawCaps.takeawayEnabled : defaultCaps.takeawayEnabled,
    paymentsEnabled: typeof rawCaps?.paymentsEnabled === 'boolean' ? rawCaps.paymentsEnabled : defaultCaps.paymentsEnabled
  };

  // 3. Derive allowed order types based on capabilities
  const allowedOrderTypes: OrderType[] = [];
  if (capabilities.tablesEnabled) {
    allowedOrderTypes.push('dineIn');
  }
  if (capabilities.takeawayEnabled) {
    allowedOrderTypes.push('takeaway');
  }
  if (capabilities.deliveryEnabled) {
    allowedOrderTypes.push('delivery');
  }
  // Guarantee at least one order type is always accessible
  if (allowedOrderTypes.length === 0) {
    allowedOrderTypes.push(capabilities.tablesEnabled ? 'dineIn' : 'takeaway');
  }

  const defaultOrderType: OrderType =
    capabilities.tablesEnabled && allowedOrderTypes.includes('dineIn')
      ? 'dineIn'
      : allowedOrderTypes[0];

  // 4. Derive navigation visibility
  const navigation = {
    isPosVisible: true,
    isCaptainVisible: capabilities.captainEnabled,
    isKitchenVisible: capabilities.kitchenEnabled,
    isOrdersVisible: true,
    isPaymentsVisible: capabilities.paymentsEnabled,
    isInventoryVisible: capabilities.inventoryEnabled,
    isDashboardVisible: true,
    isReportsVisible: true,
    isAuditVisible: true,
    isStaffVisible: mode !== 'single_person', // Hide staff management for purely single-person operations
    isRestaurantVisible: true,
    isCategoriesVisible: true,
    isItemsVisible: true
  };

  // 5. Derive workflow parameters
  const workflow = {
    hasKitchenFlow: capabilities.kitchenEnabled,
    hasCaptainFlow: capabilities.captainEnabled,
    hasTableFlow: capabilities.tablesEnabled,
    directBillAndPay: !capabilities.kitchenEnabled
  };

  // 6. Derive POS behavior
  const posBehavior = {
    showTableSelector: capabilities.tablesEnabled,
    showOrderTypeSelector: allowedOrderTypes.length > 1,
    allowedOrderTypes,
    defaultOrderType,
    allowDirectPayment: !capabilities.kitchenEnabled,
    primaryActionLabel: capabilities.kitchenEnabled ? 'Send to Kitchen (KOT)' : 'Review & Pay',
    requiresKotBeforePayment: capabilities.kitchenEnabled
  };

  return {
    mode,
    capabilities,
    navigation,
    workflow,
    posBehavior
  };
}

/**
 * Checks whether a specific capability is active on the given restaurant.
 */
export function isCapabilityEnabled(
  restaurant: Restaurant | null | undefined,
  capability: keyof RestaurantCapabilities
): boolean {
  const profile = getRestaurantOperatingProfile(restaurant);
  return profile.capabilities[capability] === true;
}

/**
 * Operating mode metadata for setup cards and UI descriptions.
 */
export interface ModeMetadata {
  id: RestaurantOperatingMode;
  name: string;
  iconName: string;
  tagline: string;
  description: string;
  workflowSteps: string[];
}

export const OPERATING_MODE_METADATA: ModeMetadata[] = [
  {
    id: 'single_person',
    name: 'Single Person',
    iconName: 'UtensilsCrossed',
    tagline: 'Fast Billing & Counter Operations',
    description: 'One person handles billing, orders and daily operations directly.',
    workflowSteps: ['Order Type', 'Select Items', 'Cart & Bill', 'Payment', 'Complete']
  },
  {
    id: 'small_team',
    name: 'Small Team',
    iconName: 'Users',
    tagline: 'Streamlined Team Workflow',
    description: 'Small team with optional kitchen KOT, without requiring dedicated captain/waiter app routing.',
    workflowSteps: ['Order', 'Kitchen KOT', 'Review Bill', 'Payment', 'Complete']
  },
  {
    id: 'full_service',
    name: 'Full-Service Restaurant',
    iconName: 'Building2',
    tagline: 'Multi-Station Hospitality',
    description: 'Dedicated stations for captains/waiters, kitchen KOT display, and cashier settlement.',
    workflowSteps: ['Captain / Table', 'KOT Dispatch', 'Kitchen Prep', 'Bill Generation', 'Payment', 'Table Close']
  },
  {
    id: 'custom',
    name: 'Custom Setup',
    iconName: 'Settings',
    tagline: 'Tailored Operations',
    description: 'Choose exactly what modules and workflows your restaurant requires.',
    workflowSteps: ['Customized according to enabled capabilities']
  }
];
