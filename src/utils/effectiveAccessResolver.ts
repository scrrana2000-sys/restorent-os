/**
 * Central Effective Access Resolver for RestaurantOS
 *
 * Implements the dual-layer control rule:
 * effectiveFeatureAccess = subscriptionEntitlement(feature) AND operatingModelCapability(feature)
 *
 * Evaluates both:
 * 1. Current active subscription entitlement (PlanLimits)
 * 2. Operating model capability (RestaurantCapabilities / Store Format)
 * 3. User RBAC role permissions
 *
 * Provides clear denial reasons:
 * - GRANTED: Feature is allowed by all layers.
 * - SUBSCRIPTION_REQUIRED: Feature is not included in the active subscription tier.
 * - OPERATING_MODEL_DISABLED: Feature is included in the subscription plan, but disabled in Operating Model.
 * - EXPIRED_SUBSCRIPTION: Subscription or trial has expired.
 * - ROLE_RESTRICTED: User's staff role does not have permission.
 */

import { SubscriptionEntitlements } from '../types/subscription';
import { RestaurantOperatingProfile } from '../config/restaurantOperatingModes';
import { isFeatureEntitled, getMinimumRequiredPlan } from './subscriptionEntitlements';
import { isViewAllowed } from './permissions';
import { StaffRole } from '../types/auth';

export type DenialReason =
  | 'GRANTED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'OPERATING_MODEL_DISABLED'
  | 'EXPIRED_SUBSCRIPTION'
  | 'ROLE_RESTRICTED';

export interface EffectiveAccessParams {
  featureOrView: string;
  entitlements: SubscriptionEntitlements | null | undefined;
  operatingProfile?: RestaurantOperatingProfile | null;
  userRole?: string;
}

export interface EffectiveAccessResult {
  allowed: boolean;
  reason: DenialReason;
  featureOrView: string;
  requiredPlan?: string;
  message: string;
  actionType: 'none' | 'upgrade_plan' | 'configure_operating_model' | 'renew_subscription' | 'contact_admin';
}

/**
 * Maps view or feature identifiers to corresponding PlanLimits key and Operating Capabilities key.
 */
function mapFeatureToKeys(featureOrView: string): {
  planFeatureKey?: keyof import('../types/subscription').PlanLimits;
  operatingCapabilityKey?: keyof import('../types/restaurant').RestaurantCapabilities;
  isCoreView?: boolean;
} {
  switch (featureOrView) {
    case 'kitchen':
    case 'kitchenDisplay':
      return { planFeatureKey: 'kitchenDisplay', operatingCapabilityKey: 'kitchenEnabled' };
    case 'captain':
    case 'captainHandheld':
      return { planFeatureKey: 'captainHandheld', operatingCapabilityKey: 'captainEnabled' };
    case 'inventory':
    case 'inventoryManagement':
      return { planFeatureKey: 'inventoryManagement', operatingCapabilityKey: 'inventoryEnabled' };
    case 'customers':
    case 'customerCrm':
      return { planFeatureKey: 'customerCrm' };
    case 'onlineOrdering':
      return { planFeatureKey: 'onlineOrdering', operatingCapabilityKey: 'takeawayEnabled' };
    case 'voiceAssistant':
      return { planFeatureKey: 'voiceAssistant' };
    case 'tables':
      return { operatingCapabilityKey: 'tablesEnabled' };
    case 'pos':
    case 'orders':
    case 'reports':
    case 'payments':
    case 'dashboard':
    case 'staff':
    case 'settings':
    case 'restaurant':
    case 'subscription':
    case 'categories':
    case 'items':
    case 'audit':
      return { isCoreView: true };
    default:
      return { isCoreView: true };
  }
}

const ADMIN_VIEWS = [
  'pos', 'kitchen', 'captain', 'dashboard', 'restaurant',
  'categories', 'items', 'settings', 'reports', 'audit',
  'orders', 'payments', 'staff', 'inventory', 'customers', 'subscription'
];

export function getEffectiveFeatureAccess(params: EffectiveAccessParams): EffectiveAccessResult {
  const { featureOrView, entitlements, operatingProfile, userRole } = params;
  const currentPlanName = entitlements?.plan?.name || 'Starter';

  // 1. RBAC Check (only if featureOrView is an AdminView)
  if (userRole && ADMIN_VIEWS.includes(featureOrView)) {
    if (!isViewAllowed(userRole as StaffRole, featureOrView)) {
      return {
        allowed: false,
        reason: 'ROLE_RESTRICTED',
        featureOrView,
        message: `Your staff role (${userRole}) does not have permission to access the "${featureOrView}" panel.`,
        actionType: 'contact_admin'
      };
    }
  }

  // 2. First-login trial: all subscription-gated modules are available
  // for the entire seven-day trial, including modules disabled by a paid-plan
  // tier or adaptive operating-model capability. RBAC still applies above.
  if (entitlements?.hasValidTrial && featureOrView !== 'subscription') {
    return {
      allowed: true,
      reason: 'GRANTED',
      featureOrView,
      message: 'Feature access granted during the 7-day free trial.',
      actionType: 'none'
    };
  }

  // 3. Subscription Expired Check (except for 'subscription' view)
  if (featureOrView !== 'subscription') {
    if (entitlements && !entitlements.canPerformOperationalActions) {
      return {
        allowed: false,
        reason: 'EXPIRED_SUBSCRIPTION',
        featureOrView,
        message: `Your ${currentPlanName} subscription or trial has expired. Renew your plan to perform operational actions.`,
        actionType: 'renew_subscription'
      };
    }
  }

  const { planFeatureKey, operatingCapabilityKey, isCoreView } = mapFeatureToKeys(featureOrView);

  // Core administrative views are allowed if subscription is active
  if (isCoreView) {
    return {
      allowed: true,
      reason: 'GRANTED',
      featureOrView,
      message: 'Feature access granted.',
      actionType: 'none'
    };
  }

  // 4. Subscription Tier Entitlement Check
  let hasSubscriptionEntitlement = true;
  let requiredPlan = 'Starter';

  if (planFeatureKey) {
    hasSubscriptionEntitlement = isFeatureEntitled(entitlements, planFeatureKey);
    requiredPlan = getMinimumRequiredPlan(featureOrView);
  }

  // 5. Operating Model Capability Check
  let hasOperatingCapability = true;
  if (operatingCapabilityKey && operatingProfile?.capabilities) {
    hasOperatingCapability = Boolean(operatingProfile.capabilities[operatingCapabilityKey]);
  }

  // 6. Evaluate combined access
  if (!hasSubscriptionEntitlement) {
    // Subscription entitlement missing
    return {
      allowed: false,
      reason: 'SUBSCRIPTION_REQUIRED',
      featureOrView,
      requiredPlan,
      message: `${requiredPlan} Plan Required. Upgrade your subscription from ${currentPlanName} to unlock ${featureOrView}.`,
      actionType: 'upgrade_plan'
    };
  }

  if (!hasOperatingCapability) {
    // Subscription entitlement present, BUT Operating Model capability is disabled!
    return {
      allowed: false,
      reason: 'OPERATING_MODEL_DISABLED',
      featureOrView,
      message: `Module turned off in Operating Model settings. This feature is included in your active ${currentPlanName} plan but is currently disabled in Restaurant Setup.`,
      actionType: 'configure_operating_model'
    };
  }

  return {
    allowed: true,
    reason: 'GRANTED',
    featureOrView,
    message: 'Feature access granted.',
    actionType: 'none'
  };
}
