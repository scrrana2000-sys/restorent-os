/**
 * RestaurantOS Subscription Plan Card Component
 *
 * Renders individual commercial plan tiers with transparent monthly pricing,
 * included capabilities, explicit operational limits, and selection triggers.
 */

import React from 'react';
import { Check, Sparkles, Zap, Building2, Store, TrendingUp } from 'lucide-react';
import { BillingCycle, SubscriptionPlan } from '../../types/subscription';
import { formatPlanPrice } from '../../config/subscriptionPlans';

interface SubscriptionPlanCardProps {
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  isCurrentPlan: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

export const SubscriptionPlanCard: React.FC<SubscriptionPlanCardProps> = ({
  plan,
  billingCycle,
  isCurrentPlan,
  onSelect,
  disabled = false
}) => {
  const isTrial = plan.planId === 'trial_7d';
  const monthlyPricePaise = plan.priceMonthlyPaise;

  const getPlanIcon = () => {
    switch (plan.planId) {
      case 'starter':
        return <Store className="w-5 h-5 text-sky-400" />;
      case 'growth':
        return <TrendingUp className="w-5 h-5 text-emerald-400" />;
      case 'pro':
        return <Zap className="w-5 h-5 text-indigo-400" />;
      case 'enterprise':
        return <Building2 className="w-5 h-5 text-purple-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-emerald-400" />;
    }
  };

  return (
    <div
      id={`subscription-plan-card-${plan.planId}`}
      className={`relative rounded-2xl border flex flex-col justify-between transition-all duration-200 ${
        plan.isPopular
          ? 'bg-slate-900 border-indigo-500/80 shadow-xl shadow-indigo-950/50 ring-1 ring-indigo-500/40'
          : 'bg-slate-900 border-slate-800 hover:border-slate-700/80 shadow-md'
      } p-5 sm:p-6`}
    >
      {/* Popular badge */}
      {plan.isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[10px] font-extrabold uppercase tracking-wider shadow-md">
          Recommended
        </div>
      )}

      <div>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-slate-800/90 border border-slate-700/70 shrink-0">
              {getPlanIcon()}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white font-display">{plan.name}</h3>
              <p className="text-xs text-slate-300 line-clamp-1">{plan.tagline}</p>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="mt-4 mb-6">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-white font-mono tracking-tight">
              {isTrial ? 'Free' : formatPlanPrice(monthlyPricePaise, plan.currencySymbol)}
            </span>
            {!isTrial && (
              <span className="text-xs text-slate-300 font-medium">/ month</span>
            )}
          </div>
          {!isTrial && (
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              Monthly subscription. Cancel anytime.
            </p>
          )}
        </div>

        {/* Defined Limits */}
        <div className="space-y-2 pt-4 border-t border-slate-800">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Operational Limits
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Table Capacity</span>
              <span className="text-white font-bold">{plan.limits.maxTables} Tables</span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Staff Accounts</span>
              <span className="text-white font-bold">{plan.limits.maxStaff} Staff</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-300 flex items-center gap-1.5 pt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${plan.limits.multiDevice ? 'bg-indigo-400' : 'bg-slate-500'}`} />
            <span>{plan.limits.multiDevice ? 'Multi-Station & Captain Handhelds' : 'Single Station POS'}</span>
          </div>
        </div>

        {/* Features list */}
        <div className="space-y-2.5 pt-4 border-t border-slate-800 mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Included Capabilities
          </p>
          <ul className="space-y-2">
            {plan.features.map((feat, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-xs text-slate-200">
                <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3 h-3" />
                </div>
                <span className="leading-snug text-slate-200">{feat}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Plan Action CTA */}
      <div className="mt-8 pt-4">
        {isCurrentPlan ? (
          <div className="w-full min-h-[44px] py-3 rounded-xl bg-slate-800/90 border border-slate-700 text-center text-xs font-bold text-emerald-400 flex items-center justify-center gap-1.5">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>Current Plan</span>
          </div>
        ) : isTrial ? (
          <div className="w-full min-h-[44px] py-3 rounded-xl bg-slate-800/50 border border-slate-800 text-center text-xs font-semibold text-slate-300 flex items-center justify-center">
            Default Starter Window
          </div>
        ) : (
          <button
            id={`select-plan-${plan.planId}-btn`}
            onClick={onSelect}
            disabled={disabled}
            className={`w-full min-h-[44px] py-3 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 ${
              plan.isPopular
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950/60'
                : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span>Select {plan.name} Plan</span>
          </button>
        )}
      </div>
    </div>
  );
};
