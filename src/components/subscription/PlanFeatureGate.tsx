import React from 'react';
import {
  Lock,
  Sparkles,
  ArrowRight,
  MonitorCheck,
  CookingPot,
  Layers,
  Boxes,
  UserCheck,
  Mic,
  ShieldCheck,
  CheckCircle2,
  Sliders
} from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { useRestaurant } from '../../context/RestaurantContext';
import { getMinimumRequiredPlan } from '../../utils/subscriptionEntitlements';
import { getEffectiveFeatureAccess } from '../../utils/effectiveAccessResolver';

interface PlanFeatureGateProps {
  featureId: string;
  title?: string;
  description?: string;
  onNavigateToSubscription: () => void;
  onBackToPos?: () => void;
  onNavigateToRestaurantSetup?: () => void;
}

const FEATURE_METADATA: Record<
  string,
  {
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    benefits: string[];
    requiredPlan: string;
  }
> = {
  kitchen: {
    title: 'Live Kitchen Display System (KDS)',
    description:
      'Real-time order routing to kitchen stations, status tracking, item-level prep timers, and paperless KOT display.',
    icon: CookingPot,
    benefits: [
      'Zero communication errors between servers and chefs',
      'Real-time ticket prep timers and alert thresholds',
      'Station-specific routing for appetizers, mains, and bar',
      'Supports touchscreen bumping and ticket audio alerts'
    ],
    requiredPlan: 'Growth'
  },
  captain: {
    title: 'Captain & Table Ordering Station',
    description:
      'Handheld mobile POS for floor captains to take table orders, fire KOTs, and print guest checks instantly.',
    icon: Layers,
    benefits: [
      'Multi-device concurrency for simultaneous table floor ordering',
      'Live table status indicators (Occupied, Billed, Available)',
      'Instant item search and dietary customization modifiers',
      'Accelerated table turnaround time during peak rushes'
    ],
    requiredPlan: 'Growth'
  },
  inventory: {
    title: 'Raw Material Inventory & Stock Control',
    description:
      'Automated ingredient-level inventory tracking, low-stock threshold alerts, and recipe depletion management.',
    icon: Boxes,
    benefits: [
      'Automatic ingredient depletion upon completed orders',
      'Low stock warning badges and reorder notifications',
      'Stock adjustments, wastage logging, and audit tracking',
      'Cost-of-goods and food cost profit margin calculations'
    ],
    requiredPlan: 'Growth'
  },
  customers: {
    title: 'Customer CRM & Loyalty Insights',
    description:
      'Customer profile management, visit frequency tracking, lifetime spending metrics, and personalized engagement.',
    icon: UserCheck,
    benefits: [
      'Customer directory with total orders and lifetime spend',
      'Favorite item purchase history and last visit tracking',
      'Delivery address book and special dietary preferences',
      'VIP guest tagging and loyalty retention insights'
    ],
    requiredPlan: 'Growth'
  },
  voiceAssistant: {
    title: 'Hands-Free AI Voice POS Assistant',
    description:
      'State-of-the-art multilingual speech recognition for instant voice order taking in Hindi & English.',
    icon: Mic,
    benefits: [
      'Order taking via natural voice commands',
      'Understands spoken numbers, item names, and quantity changes',
      'Works in noisy restaurant environments with smart fuzzy matching',
      'Accelerates order punch times by up to 60%'
    ],
    requiredPlan: 'Pro'
  }
};

export const PlanFeatureGate: React.FC<PlanFeatureGateProps> = ({
  featureId,
  title,
  description,
  onNavigateToSubscription,
  onBackToPos,
  onNavigateToRestaurantSetup
}) => {
  const { entitlements, openPaymentModal } = useSubscription();
  const { operatingProfile } = useRestaurant();

  const access = getEffectiveFeatureAccess({
    featureOrView: featureId,
    entitlements,
    operatingProfile
  });

  const meta = FEATURE_METADATA[featureId] || {
    title: title || 'Feature Restricted',
    description:
      description ||
      'This feature is currently unavailable based on your active plan or operating mode.',
    icon: Lock,
    benefits: [
      'Unlock multi-device concurrent operations',
      'Automate kitchen order routing and workflows',
      'Scale your restaurant floor and staff capacity'
    ],
    requiredPlan: getMinimumRequiredPlan(featureId)
  };

  const Icon = meta.icon;
  const currentPlanName = entitlements?.plan?.name || 'Starter';
  const targetPlanId = meta.requiredPlan.toLowerCase();

  const isOperatingModelDisabled = access.reason === 'OPERATING_MODEL_DISABLED';

  return (
    <div className="max-w-3xl mx-auto my-8 p-6 sm:p-8 bg-white border border-slate-200 rounded-3xl shadow-sm text-slate-800">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              {isOperatingModelDisabled ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-300 flex items-center gap-1">
                  <Sliders className="w-3 h-3 text-slate-600" />
                  Turned Off in Operating Model
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {meta.requiredPlan} Plan Required
                </span>
              )}
              <span className="text-xs text-slate-400 font-medium">
                Current Plan: <strong className="text-slate-700">{currentPlanName}</strong>
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 mt-1">
              {meta.title}
            </h2>
          </div>
        </div>

        {isOperatingModelDisabled ? (
          <button
            type="button"
            onClick={() => {
              if (onNavigateToRestaurantSetup) {
                onNavigateToRestaurantSetup();
              } else {
                onNavigateToSubscription();
              }
            }}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Sliders className="w-4 h-4" />
            <span>Enable in Operating Model</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (openPaymentModal) {
                openPaymentModal(targetPlanId, 'annual');
              } else {
                onNavigateToSubscription();
              }
            }}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Upgrade to {meta.requiredPlan}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Description & Value Proposition */}
      <div className="py-6">
        <p className="text-sm text-slate-600 leading-relaxed">
          {isOperatingModelDisabled
            ? `This module is included in your active ${currentPlanName} plan, but it is currently turned off in your Adaptive Operating Model settings in Restaurant Setup. You can enable it anytime without upgrading your subscription.`
            : meta.description}
        </p>

        <div className="mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            {isOperatingModelDisabled ? 'Module Capabilities:' : `What you unlock with ${meta.requiredPlan}:`}
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {meta.benefits.map((benefit, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-700 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
        {onBackToPos && (
          <button
            type="button"
            onClick={onBackToPos}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <MonitorCheck className="w-3.5 h-3.5" />
            Return to POS Terminal
          </button>
        )}
        <button
          type="button"
          onClick={onNavigateToSubscription}
          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors ml-auto"
        >
          View all plans & features →
        </button>
      </div>
    </div>
  );
};

