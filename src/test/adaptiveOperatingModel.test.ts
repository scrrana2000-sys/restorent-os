import { describe, it, expect } from 'vitest';
import {
  FULL_SERVICE_CAPABILITIES,
  SINGLE_PERSON_CAPABILITIES,
  SMALL_TEAM_CAPABILITIES,
  getDefaultCapabilitiesForMode,
  getRestaurantOperatingProfile
} from '../config/restaurantOperatingModes';
import { Restaurant } from '../types/restaurant';
import {
  getVoiceAssistantSettings,
  setVoiceAssistantCompletelyHidden,
  setVoiceAssistantEnabled
} from '../services/voice/voiceSettings';

describe('M8.5 Adaptive Operating Model & Small Restaurant Mode Suite', () => {
  describe('1. Default Capabilities by Operating Mode', () => {
    it('full_service has all modules enabled', () => {
      const caps = getDefaultCapabilitiesForMode('full_service');
      expect(caps.tablesEnabled).toBe(true);
      expect(caps.kitchenEnabled).toBe(true);
      expect(caps.captainEnabled).toBe(true);
      expect(caps.inventoryEnabled).toBe(true);
      expect(caps.takeawayEnabled).toBe(true);
      expect(caps.deliveryEnabled).toBe(true);
      expect(caps.paymentsEnabled).toBe(true);
    });

    it('single_person has kitchen and captain disabled by default', () => {
      const caps = getDefaultCapabilitiesForMode('single_person');
      expect(caps.tablesEnabled).toBe(true);
      expect(caps.kitchenEnabled).toBe(false);
      expect(caps.captainEnabled).toBe(false);
      expect(caps.inventoryEnabled).toBe(true);
      expect(caps.paymentsEnabled).toBe(true);
    });

    it('small_team has kitchen enabled but captain disabled', () => {
      const caps = getDefaultCapabilitiesForMode('small_team');
      expect(caps.tablesEnabled).toBe(true);
      expect(caps.kitchenEnabled).toBe(true);
      expect(caps.captainEnabled).toBe(false);
      expect(caps.inventoryEnabled).toBe(true);
      expect(caps.paymentsEnabled).toBe(true);
    });
  });

  describe('2. Backward Compatibility & Fallback Invariants', () => {
    it('null or undefined restaurant resolves to full_service profile', () => {
      const profile = getRestaurantOperatingProfile(null);
      expect(profile.mode).toBe('full_service');
      expect(profile.capabilities).toEqual(FULL_SERVICE_CAPABILITIES);
      expect(profile.navigation.isKitchenVisible).toBe(true);
      expect(profile.navigation.isCaptainVisible).toBe(true);
      expect(profile.workflow.hasKitchenFlow).toBe(true);
      expect(profile.posBehavior.requiresKotBeforePayment).toBe(true);
    });

    it('restaurant document without operatingMode falls back to full_service', () => {
      const legacyRestaurant: Partial<Restaurant> = {
        restaurantId: 'rest_legacy_101',
        name: 'Legacy Indian Diner',
        ownerId: 'owner_1'
      };
      const profile = getRestaurantOperatingProfile(legacyRestaurant as Restaurant);
      expect(profile.mode).toBe('full_service');
      expect(profile.capabilities.tablesEnabled).toBe(true);
      expect(profile.capabilities.kitchenEnabled).toBe(true);
      expect(profile.workflow.directBillAndPay).toBe(false);
    });
  });

  describe('3. Profile Navigation and Workflow Derivations', () => {
    it('single_person mode configures fast counter workflow and suppresses kitchen/captain nav', () => {
      const singlePersonRest: Partial<Restaurant> = {
        restaurantId: 'rest_sp_1',
        name: 'Chai & Samosa Stall',
        restaurantOperatingMode: 'single_person',
        restaurantCapabilities: SINGLE_PERSON_CAPABILITIES
      };
      const profile = getRestaurantOperatingProfile(singlePersonRest as Restaurant);
      expect(profile.mode).toBe('single_person');
      expect(profile.navigation.isKitchenVisible).toBe(false);
      expect(profile.navigation.isCaptainVisible).toBe(false);
      expect(profile.navigation.isStaffVisible).toBe(false);
      expect(profile.navigation.isPosVisible).toBe(true);
      expect(profile.workflow.hasKitchenFlow).toBe(false);
      expect(profile.workflow.hasCaptainFlow).toBe(false);
      expect(profile.workflow.directBillAndPay).toBe(true);
      expect(profile.posBehavior.requiresKotBeforePayment).toBe(false);
    });

    it('small_team mode allows kitchen view but hides captain view', () => {
      const smallTeamRest: Partial<Restaurant> = {
        restaurantId: 'rest_st_1',
        name: 'Mom & Pop Bakery Cafe',
        restaurantOperatingMode: 'small_team',
        restaurantCapabilities: SMALL_TEAM_CAPABILITIES
      };
      const profile = getRestaurantOperatingProfile(smallTeamRest as Restaurant);
      expect(profile.mode).toBe('small_team');
      expect(profile.navigation.isKitchenVisible).toBe(true);
      expect(profile.navigation.isCaptainVisible).toBe(false);
      expect(profile.workflow.hasKitchenFlow).toBe(true);
      expect(profile.workflow.hasCaptainFlow).toBe(false);
    });

    it('custom mode respects individual capability overrides', () => {
      const customRest: Partial<Restaurant> = {
        restaurantId: 'rest_custom_1',
        name: 'Boutique Food Truck',
        restaurantOperatingMode: 'custom',
        restaurantCapabilities: {
          tablesEnabled: false,
          kitchenEnabled: false,
          captainEnabled: false,
          inventoryEnabled: true,
          takeawayEnabled: true,
          deliveryEnabled: true,
          paymentsEnabled: true
        }
      };
      const profile = getRestaurantOperatingProfile(customRest as Restaurant);
      expect(profile.mode).toBe('custom');
      expect(profile.workflow.hasTableFlow).toBe(false);
      expect(profile.workflow.hasKitchenFlow).toBe(false);
      expect(profile.navigation.isKitchenVisible).toBe(false);
      expect(profile.navigation.isCaptainVisible).toBe(false);
      expect(profile.navigation.isInventoryVisible).toBe(true);
      expect(profile.workflow.directBillAndPay).toBe(true);
    });

    it('custom mode with tablesEnabled=false suppresses table selector and removes dineIn from allowedOrderTypes', () => {
      const customNoTables: Partial<Restaurant> = {
        restaurantId: 'rest_custom_notables',
        name: 'Kiosk Only',
        restaurantOperatingMode: 'custom',
        restaurantCapabilities: {
          tablesEnabled: false,
          kitchenEnabled: false,
          captainEnabled: false,
          inventoryEnabled: true,
          takeawayEnabled: true,
          deliveryEnabled: true,
          paymentsEnabled: true
        }
      };
      const profile = getRestaurantOperatingProfile(customNoTables as Restaurant);
      expect(profile.posBehavior.showTableSelector).toBe(false);
      expect(profile.posBehavior.allowedOrderTypes).not.toContain('dineIn');
      expect(profile.posBehavior.allowedOrderTypes).toContain('takeaway');
      expect(profile.posBehavior.defaultOrderType).toBe('takeaway');
    });

    it('custom mode with deliveryEnabled=false and takeawayEnabled=false retains only permitted order types', () => {
      const dineInOnly: Partial<Restaurant> = {
        restaurantId: 'rest_dinein_only',
        name: 'Fine Dining Salon',
        restaurantOperatingMode: 'custom',
        restaurantCapabilities: {
          tablesEnabled: true,
          kitchenEnabled: true,
          captainEnabled: true,
          inventoryEnabled: true,
          takeawayEnabled: false,
          deliveryEnabled: false,
          paymentsEnabled: true
        }
      };
      const profile = getRestaurantOperatingProfile(dineInOnly as Restaurant);
      expect(profile.posBehavior.allowedOrderTypes).toEqual(['dineIn']);
      expect(profile.posBehavior.defaultOrderType).toBe('dineIn');
    });
  });

  describe('4. POS Behavior & Order Dispatching Integrity', () => {
    it('single person mode enforces direct payment and no KOT requirement', () => {
      const profile = getRestaurantOperatingProfile({
        restaurantId: 'rest_1',
        restaurantOperatingMode: 'single_person'
      } as Restaurant);

      expect(profile.posBehavior.requiresKotBeforePayment).toBe(false);
      expect(profile.posBehavior.allowDirectPayment).toBe(true);
      expect(profile.workflow.hasKitchenFlow).toBe(false);
    });

    it('full service mode requires KOT workflow and preserves table flow', () => {
      const profile = getRestaurantOperatingProfile({
        restaurantId: 'rest_2',
        restaurantOperatingMode: 'full_service'
      } as Restaurant);

      expect(profile.posBehavior.requiresKotBeforePayment).toBe(true);
      expect(profile.workflow.hasKitchenFlow).toBe(true);
      expect(profile.workflow.hasTableFlow).toBe(true);
      expect(profile.navigation.isCaptainVisible).toBe(true);
    });
  });

  describe('5. Security & RBAC Isolation Invariants', () => {
    it('operating profile mode does not grant bypass to underlying security capabilities', () => {
      // Even if single_person mode hides staff view, restaurant setup permissions are strictly bounded
      const profile = getRestaurantOperatingProfile({
        restaurantId: 'rest_sec_1',
        restaurantOperatingMode: 'single_person'
      } as Restaurant);

      // Verify the profile only provides UI flags, not RBAC role overrides
      expect(profile).not.toHaveProperty('role');
      expect(profile).not.toHaveProperty('permissions');
      expect(profile.capabilities.paymentsEnabled).toBe(true);
      expect(profile.capabilities.kitchenEnabled).toBe(false);
    });
  });

  describe('6. Voice Assistant Full Close and Settings Persistence', () => {
    it('user can completely hide voice assistant via settings helper', () => {
      const initial = getVoiceAssistantSettings();
      expect(typeof initial.enabled).toBe('boolean');

      const closed = setVoiceAssistantCompletelyHidden(true);
      expect(closed.completelyHidden).toBe(true);

      const refreshed = getVoiceAssistantSettings();
      expect(refreshed.completelyHidden).toBe(true);

      const restored = setVoiceAssistantCompletelyHidden(false);
      expect(restored.completelyHidden).toBe(false);
    });
  });
});
