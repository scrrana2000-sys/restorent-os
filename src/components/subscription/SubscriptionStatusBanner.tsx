/**
 * RestaurantOS Subscription Status Banner
 *
 * Displays trial countdown, expiring soon alerts, and expiration notices.
 * Can be embedded at the top of the Owner Center or POS.
 */

import React from 'react';
import { Sparkles, Clock, AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { formatSubscriptionDate } from '../../utils/subscriptionEntitlements';

interface SubscriptionStatusBannerProps {
  onOpenPlans?: () => void;
  compact?: boolean;
}

export const SubscriptionStatusBanner: React.FC<SubscriptionStatusBannerProps> = ({
  onOpenPlans,
  compact = false
}) => {
  const { subscription, entitlements, openPaymentModal } = useSubscription();

  if (!subscription) return null;

  const handleAction = () => {
    if (onOpenPlans) {
      onOpenPlans();
    } else {
      openPaymentModal('pro', 'monthly');
    }
  };

  // Case 1: Trial Expired
  if (entitlements.status === 'trial_expired') {
    return (
      <div
        id="subscription-banner-trial-expired"
        className="w-full bg-rose-950/90 border border-rose-800/80 rounded-2xl text-white px-4 py-3.5 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl shadow-rose-950/40 mb-6"
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-rose-600/30 border border-rose-500/50 flex items-center justify-center text-rose-300 shrink-0 mt-0.5 sm:mt-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-black text-sm text-white">7-Day Free Trial Expired</span>
              <span className="text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded-md bg-rose-900/80 text-rose-200 border border-rose-700/60">
                Action Required
              </span>
            </div>
            <p className="text-xs text-rose-200/90 mt-1">
              Your free trial ended on {formatSubscriptionDate(subscription.trialEndsAt)}. Choose a plan to unlock live POS and Kitchen routing.
            </p>
          </div>
        </div>
        <button
          id="subscription-banner-choose-plan-btn"
          onClick={handleAction}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-all shadow-md shadow-rose-950/60 flex items-center justify-center gap-2 cursor-pointer shrink-0 min-h-[40px]"
        >
          <span>Choose a Plan</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Case 2: Subscription Expired
  if (entitlements.status === 'expired') {
    return (
      <div
        id="subscription-banner-expired"
        className="w-full bg-amber-950/90 border border-amber-800/80 rounded-2xl text-white px-4 py-3.5 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl mb-6"
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-600/30 border border-amber-500/50 flex items-center justify-center text-amber-300 shrink-0 mt-0.5 sm:mt-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <span className="font-black text-sm text-white">Subscription Expired</span>
            <p className="text-xs text-amber-200/90 mt-1">
              Your billing period ended on {formatSubscriptionDate(subscription.currentPeriodEnd)}. Renew to maintain uninterrupted service.
            </p>
          </div>
        </div>
        <button
          onClick={handleAction}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer shrink-0 min-h-[40px]"
        >
          <span>Renew Subscription</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Case 3: Expiring Soon (Trial or Active <= 2 days)
  if (entitlements.isExpiringSoon) {
    const isTrial = entitlements.status === 'trial';
    return (
      <div
        id="subscription-banner-expiring-soon"
        className="w-full bg-indigo-950/90 border border-indigo-800/80 rounded-2xl text-white px-4 py-3 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl mb-6"
      >
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
          <p className="text-xs sm:text-sm text-indigo-100">
            <strong className="text-white font-bold">
              {isTrial ? 'Free Trial' : 'Subscription'} Ending Soon:
            </strong>{' '}
            {entitlements.daysRemaining > 0
              ? `${entitlements.daysRemaining} day${entitlements.daysRemaining === 1 ? '' : 's'}`
              : `${entitlements.hoursRemaining} hours`} remaining{' '}
            (ends <span className="font-semibold text-white">{formatSubscriptionDate(isTrial ? subscription.trialEndsAt : subscription.currentPeriodEnd)}</span>).
          </p>
        </div>
        <button
          onClick={handleAction}
          className="w-full sm:w-auto text-xs font-bold px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer shrink-0 min-h-[40px]"
        >
          <span>{isTrial ? 'Upgrade to Pro' : 'Renew Plan'}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Case 4: Active Free Trial (normal compact banner)
  if (entitlements.status === 'trial') {
    if (compact) {
      return (
        <button
          onClick={handleAction}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-xs font-semibold text-indigo-200 transition-colors"
          title={`Trial ends on ${formatSubscriptionDate(subscription.trialEndsAt)}`}
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Trial: {entitlements.daysRemaining}d left</span>
        </button>
      );
    }

    return (
      <div
        id="subscription-banner-trial"
        className="w-full bg-slate-900 border border-slate-800 rounded-2xl text-white px-4 py-3 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md mb-6"
      >
        <div className="flex items-center gap-3 text-xs text-slate-200">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <div>
            <span className="font-bold text-white mr-1.5">7-Day Free Trial:</span>
            <span className="text-slate-300">
              {entitlements.daysRemaining} days remaining (valid until {formatSubscriptionDate(subscription.trialEndsAt)})
            </span>
          </div>
        </div>
        <button
          id="subscription-banner-view-plans-btn"
          onClick={handleAction}
          className="text-xs font-bold text-indigo-300 hover:text-white bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 px-3.5 py-1.5 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto min-h-[36px]"
        >
          <span>Choose a Plan</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return null;
};
