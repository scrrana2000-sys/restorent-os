/**
 * RestaurantOS Subscription & Billing Management View
 *
 * Integrated into Owner Center for commercial plan selection,
 * 7-day trial tracking, custom solution inquiries, and payment audit logs.
 */

import React, { useState } from 'react';
import {
  Sparkles,
  ShieldCheck,
  Clock,
  CreditCard,
  History,
  CheckCircle2,
  AlertCircle,
  Mail,
  ExternalLink
} from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import {
  COMMERCIAL_PLANS,
  CUSTOMIZATION_CONFIG,
  formatPlanPrice
} from '../../config/subscriptionPlans';
import { BillingCycle } from '../../types/subscription';
import { SubscriptionPlanCard } from './SubscriptionPlanCard';
import { SubscriptionPaymentModal } from './SubscriptionPaymentModal';
import { formatSubscriptionDate } from '../../utils/subscriptionEntitlements';
import { useAuth } from '../../context/AuthContext';

export const SubscriptionView: React.FC = () => {
  const { subscription, history, entitlements, openPaymentModal } = useSubscription();
  const { profile } = useAuth();
  const [billingCycle] = useState<BillingCycle>('monthly');

  const isOwner = profile?.role === 'owner' || !profile?.role;

  const getStatusBadge = () => {
    switch (entitlements.status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Active Subscription</span>
          </span>
        );
      case 'trial':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>7-Day Free Trial ({entitlements.daysRemaining} days remaining)</span>
          </span>
        );
      case 'trial_expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 text-xs font-bold">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Free Trial Expired</span>
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold">
            <Clock className="w-3.5 h-3.5" />
            <span>Subscription Expired</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header & Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black font-display text-white tracking-tight">
              Subscription & Plans
            </h1>
            {getStatusBadge()}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Manage your restaurant subscription tier, 7-day trial entitlements, and billing history.
          </p>
        </div>

        {/* Current Entitlement Quick Info */}
        <div className="flex items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl px-4 py-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
            <CreditCard className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Current Plan</p>
            <p className="text-xs font-bold text-white">
              {entitlements.plan.name}{' '}
              <span className="text-[10px] text-slate-400 font-normal">
                ({subscription?.billingCycle === 'annual' ? 'Annual' : 'Monthly'})
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Active Subscription Summary Card */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6 shadow-xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Entitlement Status</p>
            <p className="text-base font-bold text-white mt-1 capitalize">
              {entitlements.status.replace('_', ' ')}
            </p>
            <p className="text-xs text-slate-300 mt-0.5">
              {entitlements.status === 'trial'
                ? `Valid until ${formatSubscriptionDate(subscription?.trialEndsAt)}`
                : `Renewal date: ${formatSubscriptionDate(subscription?.currentPeriodEnd)}`}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Time Remaining</p>
            <p className="text-base font-bold text-white mt-1">
              {entitlements.isSubscriptionExpired
                ? '0 days (Expired)'
                : `${entitlements.daysRemaining} day${entitlements.daysRemaining === 1 ? '' : 's'}`}
            </p>
            <p className="text-xs text-slate-300 mt-0.5">
              {entitlements.isExpiringSoon ? 'Expiring soon' : 'Active and in good standing'}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Payment Status</p>
            <p className="text-base font-bold text-white mt-1 capitalize">
              {subscription?.paymentStatus || 'None'}
            </p>
            <p className="text-xs text-slate-300 mt-0.5">
              {subscription?.lastPaymentAmount
                ? `Last paid: ${formatPlanPrice(subscription.lastPaymentAmount)}`
                : 'Free trial active'}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Access Privileges</p>
            <p className="text-base font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              <span>Full Access</span>
            </p>
            <p className="text-xs text-slate-300 mt-0.5">
              POS, Kitchen Display, Inventory & Online Ordering
            </p>
          </div>
        </div>
      </div>

      {/* Commercial Plans Header */}
      <div className="space-y-6">
        <div className="text-center max-w-xl mx-auto space-y-2 px-2">
          <h2 className="text-2xl sm:text-3xl font-black font-display text-white tracking-tight">
            Choose the Perfect Plan for Your Restaurant
          </h2>
          <p className="text-xs sm:text-sm text-slate-300">
            Transparent monthly pricing with zero hidden fees. Scale effortlessly as your business expands.
          </p>
        </div>

        {/* Commercial Plans Grid in Strict Display Order: Starter -> Growth -> Pro */}
        <div id="subscription-plans-grid" className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {COMMERCIAL_PLANS.map((plan) => (
            <SubscriptionPlanCard
              key={plan.planId}
              plan={plan}
              billingCycle={billingCycle}
              isCurrentPlan={
                subscription?.planId === plan.planId &&
                entitlements.hasActiveSubscription &&
                entitlements.status === 'active'
              }
              onSelect={() => openPaymentModal(plan.planId, billingCycle)}
              disabled={!isOwner}
            />
          ))}
        </div>
      </div>

      {/* Visual Separation Divider */}
      <div className="relative py-4">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-slate-800" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[#0B0F19] px-4 text-xs font-mono uppercase tracking-widest text-slate-400">
            Specialized Solutions
          </span>
        </div>
      </div>

      {/* Customization Section (Completely Separate, Not a Standard Subscription Plan) */}
      <div
        id="customization-solution-section"
        className="rounded-3xl border border-indigo-500/30 bg-slate-900 p-6 sm:p-8 shadow-xl relative overflow-hidden"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[11px] font-bold uppercase tracking-wider text-indigo-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{CUSTOMIZATION_CONFIG.heading}</span>
            </div>

            <h3 className="text-xl sm:text-2xl font-black font-display text-white">
              {CUSTOMIZATION_CONFIG.title}
            </h3>

            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
              {CUSTOMIZATION_CONFIG.description}
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Contact email:</span>
              <a
                href={CUSTOMIZATION_CONFIG.mailtoUrl}
                className="font-mono font-bold text-indigo-400 hover:text-indigo-300 underline transition-colors"
              >
                {CUSTOMIZATION_CONFIG.contactEmail}
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <a
              id="customization-contact-us-btn"
              href={CUSTOMIZATION_CONFIG.mailtoUrl}
              className="min-h-[44px] px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-950/60 flex items-center justify-center gap-2 transition-all cursor-pointer group"
            >
              <Mail className="w-4 h-4 text-indigo-200 group-hover:scale-110 transition-transform" />
              <span>{CUSTOMIZATION_CONFIG.buttonText}</span>
              <ExternalLink className="w-3.5 h-3.5 text-indigo-300 ml-0.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Payment & Billing History Audit Trail */}
      <div className="space-y-4 pt-6 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            <h3 className="text-base font-bold text-white font-display">Billing History & Invoices</h3>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">Immutable Audit Trail</span>
        </div>

        {history.length === 0 ? (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center text-slate-300 text-xs">
            No past billing transactions recorded yet. Free trial is currently active.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-xs text-slate-200">
              <thead className="bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Billing Cycle</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-medium">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-slate-300">{formatSubscriptionDate(item.timestamp)}</td>
                    <td className="px-4 py-3 font-bold text-white">{item.planName}</td>
                    <td className="px-4 py-3 capitalize">{item.billingCycle}</td>
                    <td className="px-4 py-3 font-mono font-bold text-indigo-300">
                      {formatPlanPrice(item.amount, '₹')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-400">{item.paymentReference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal checkout */}
      <SubscriptionPaymentModal />
    </div>
  );
};
