export type TaxMode = 'exclusive' | 'inclusive';

export type ProvisioningType = 'initial_owner' | 'explicit_outlet';

export type RestaurantOperatingMode =
  | 'single_person'
  | 'small_team'
  | 'full_service'
  | 'custom';

export interface RestaurantCapabilities {
  tablesEnabled: boolean;
  kitchenEnabled: boolean;
  captainEnabled: boolean;
  inventoryEnabled: boolean;
  deliveryEnabled: boolean;
  takeawayEnabled: boolean;
  paymentsEnabled: boolean;
}

export type PublicRestaurantStatus = 'active' | 'paused' | 'closed';

export interface Restaurant {
  restaurantId: string;
  name: string;
  legalName: string;
  logoUrl: string | null;
  bannerImageUrl?: string | null;
  coverImageUrl?: string | null;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  area?: string;
  postalCode: string;
  country: string;
  gstNumber: string;
  currency: string;
  currencySymbol: string;
  timezone: string;
  taxMode: TaxMode;
  defaultTaxRate: number;
  ownerId: string;
  provisioningType?: ProvisioningType;
  createdBy?: string;
  isActive: boolean;
  restaurantOperatingMode?: RestaurantOperatingMode;
  restaurantCapabilities?: RestaurantCapabilities;
  // M9 Public Discovery & Online Ordering Fields (Backward-compatible optionals)
  publicSlug?: string;
  publicRestaurantCode?: string;
  publicStatus?: PublicRestaurantStatus;
  onlineOrderingEnabled?: boolean;
  cuisine?: string[];
  createdAt?: any;
  updatedAt?: any;
}

export type RestaurantFormData = Omit<Restaurant, 'restaurantId' | 'ownerId' | 'createdAt' | 'updatedAt' | 'isActive'>;
