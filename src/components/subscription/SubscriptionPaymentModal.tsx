/**
 * RestaurantOS Subscription Payment Checkout Modal
 *
 * Production Razorpay Checkout Integration:
 * - Starter: ₹299 / month
 * - Growth: ₹699 / month
 * - Pro: ₹999 / month
 *
 * Security:
 * - Server-side order generation and HMAC SHA-256 signature verification.
 * - Zero card numbers, CVVs, or secret keys in client-side code or Firestore.
 * - On failure: displays clear error message and provides "Retry Payment".
 * - Existing 7-day trial remains completely safe and untouched.
 */

import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  Lock,
  CheckCircle2,
  ArrowRight,
  Loader2,
  CreditCard,
  AlertCircle,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { getPlanById, formatPlanPrice } from '../../config/subscriptionPlans';
import { BillingCycle } from '../../types/subscription';

export const SubscriptionPaymentModal: React.FC = () => {
  const {
    selectedPlanModal,
    closePaymentModal,
    processPaymentAndActivate,
    isProcessing,
    error: contextError,
    subscription
  } = useSubscription();

  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    selectedPlanModal?.cycle || 'monthly'
  );
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!selectedPlanModal) return null;

  const plan = getPlanById(selectedPlanModal.planId);
  const isAnnual = billingCycle === 'annual';
  const pricePaise = isAnnual ? plan.priceAnnualPaise : plan.priceMonthlyPaise;
  const displayError = localError || contextError;

  const handlePay = async () => {
    setLocalError(null);
    try {
      const success = await processPaymentAndActivate(plan.planId, billingCycle);
      if (success) {
        setPaymentSuccess(true);
        setTimeout(() => {
          closePaymentModal();
        }, 2200);
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Razorpay checkout encountered an issue. Please try again.');
    }
  };

  return (
    <div
      id="subscription-payment-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        id="subscription-payment-modal"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl shadow-slate-950/80 text-white relative animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Close button */}
        {!paymentSuccess && (
          <button
            id="subscription-close-modal-btn"
            onClick={closePaymentModal}
            disabled={isProcessing}
            className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {paymentSuccess ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold font-display text-white">Payment Verified & Activated!</h3>
              <p className="text-sm text-slate-400 mt-1">
                Your restaurant is now active on the <strong className="text-indigo-400">{plan.name}</strong> plan via Razorpay.
              </p>
              <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>HMAC SHA-256 Signature Verified</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[11px] font-bold uppercase tracking-wider mb-2">
                <Lock className="w-3 h-3" />
                <span>Razorpay Secure Checkout</span>
              </div>
              <h2 className="text-2xl font-black font-display text-white">
                Upgrade to {plan.name} Plan
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Official Razorpay subscription checkout. Instant multi-device activation.
              </p>
            </div>

            {/* Billing Cycle Selector */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950/60 rounded-xl border border-slate-800">
              <button
                type="button"
                id="billing-cycle-monthly-btn"
                onClick={() => setBillingCycle('monthly')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all text-center ${
                  !isAnnual
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>Monthly Billing</span>
              </button>
              <button
                type="button"
                id="billing-cycle-annual-btn"
                onClick={() => setBillingCycle('annual')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all text-center ${
                  isAnnual
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>Annual Billing (Save 17%)</span>
              </button>
            </div>

            {/* Order Breakdown */}
            <div className="rounded-xl bg-slate-950/40 border border-slate-800/80 p-4 space-y-3">
              <div className="flex justify-between text-xs text-slate-300">
                <span>
                  {plan.name} Plan ({isAnnual ? '12 Months' : '1 Month'})
                </span>
                <span className="font-mono font-medium">{formatPlanPrice(pricePaise, plan.currencySymbol)}</span>
              </div>
              <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-sm font-bold text-white">
                <span>Total Amount Due</span>
                <span className="font-mono text-indigo-400 text-lg font-black">
                  {formatPlanPrice(pricePaise, plan.currencySymbol)}
                  <span className="text-xs text-slate-400 font-normal"> / {isAnnual ? 'yr' : 'mo'}</span>
                </span>
              </div>
            </div>

            {/* Trial Status Reassurance */}
            {subscription?.status === 'trial' && (
              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs flex items-center justify-between">
                <span>7-Day Free Trial is currently active.</span>
                <span className="text-[11px] text-emerald-400 font-medium">Safe & Protected</span>
              </div>
            )}

            {/* Security Guarantee */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 text-slate-400 text-xs">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="leading-snug">
                Razorpay 256-bit encrypted checkout. No card numbers, UPI PINs, or credentials are ever stored on RestaurantOS.
              </p>
            </div>

            {/* Error Banner with Retry */}
            {displayError && (
              <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-rose-300">Payment Issue Encountered</p>
                    <p className="mt-0.5 text-rose-200/90">{displayError}</p>
                  </div>
                </div>
                <p className="text-[11px] text-rose-300/80">
                  Your restaurant features and trial remain unaffected. You can retry payment anytime.
                </p>
              </div>
            )}

            {/* Customization Link (Separate from self-serve checkout) */}
            <div className="text-center">
              <p className="text-xs text-slate-400">
                Need enterprise custom setup, custom integrations, or on-premise deployment?
              </p>
              <a
                href="mailto:radhachawan01@gmail.com?subject=RestaurantOS%20Enterprise%20Customization"
                className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium mt-1"
              >
                <span>Contact Customization (radhachawan01@gmail.com)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Pay / Retry Button */}
            <div className="pt-2 space-y-2">
              <button
                id="subscription-confirm-payment-btn"
                type="button"
                onClick={handlePay}
                disabled={isProcessing}
                className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-950 disabled:cursor-not-allowed text-white font-bold text-sm transition-all shadow-lg shadow-indigo-950/50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to Razorpay & Verifying...</span>
                  </>
                ) : displayError ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Retry Razorpay Payment ({formatPlanPrice(pricePaise, plan.currencySymbol)})</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    <span>Pay with Razorpay ({formatPlanPrice(pricePaise, plan.currencySymbol)})</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-[11px] text-center text-slate-500">
                Powered by Razorpay Payments. Subscriptions are server-verified with cryptographic HMAC signatures.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
