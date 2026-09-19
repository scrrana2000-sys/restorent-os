/**
 * RestaurantOS Subscription Payment Provider Abstraction
 *
 * Implements a pluggable payment provider architecture.
 * Supports:
 * - Razorpay (Production & Sandbox checkout with server-side HMAC verification)
 * - Mock Gateway Provider (Safe fallback simulation for unit testing & offline mode)
 *
 * Never stores raw card numbers, CVVs, or secret keys in client-side code or Firestore.
 */

import { BillingCycle, PaymentProviderType } from '../types/subscription';
import { getPlanById } from '../config/subscriptionPlans';
import { auth } from '../config/firebase';
import { getApiUrl } from '../utils/apiConfig';

export interface PaymentOrderParams {
  restaurantId: string;
  planId: string;
  billingCycle: BillingCycle;
  customerEmail?: string;
  customerName?: string;
}

export interface PaymentOrderResult {
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  currencySymbol: string;
  provider: PaymentProviderType;
  checkoutToken: string;
  keyId?: string;
  planId: string;
  billingCycle: BillingCycle;
}

export interface PaymentVerificationParams {
  restaurantId: string;
  providerOrderId: string;
  paymentId: string;
  signature: string;
  planId: string;
  billingCycle: BillingCycle;
}

export interface PaymentVerificationResult {
  verified: boolean;
  subscriptionId: string;
  transactionId: string;
  error?: string;
  subscription?: any;
}

export interface SubscriptionPaymentProvider {
  type: PaymentProviderType;
  createPaymentOrder(params: PaymentOrderParams): Promise<PaymentOrderResult>;
  verifyPayment(params: PaymentVerificationParams): Promise<PaymentVerificationResult>;
}

declare global {
  interface Window {
    Razorpay?: any;
  }
}

/**
 * Dynamically loads the official Razorpay Checkout JavaScript SDK.
 */
export async function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;

  return new Promise((resolve) => {
    const existingScript = document.getElementById('razorpay-checkout-sdk');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-checkout-sdk';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn('[Razorpay] Failed to load Razorpay checkout script.');
      resolve(false);
    };
    document.body.appendChild(script);
  });
}

/**
 * Production Razorpay Subscription Payment Provider.
 * Integrates directly with the secure backend endpoints:
 * - /api/subscription/create-order
 * - /api/subscription/verify-and-activate
 */
export class RazorpaySubscriptionPaymentProvider implements SubscriptionPaymentProvider {
  type: PaymentProviderType = 'razorpay';

  async createPaymentOrder(params: PaymentOrderParams): Promise<PaymentOrderResult> {
    const plan = getPlanById(params.planId);
    const amountPaise =
      params.billingCycle === 'annual' ? plan.priceAnnualPaise : plan.priceMonthlyPaise;

    try {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : '';

      if (token && typeof window !== 'undefined' && window.fetch) {
        const res = await fetch(getApiUrl('/api/subscription/create-order'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            restaurantId: params.restaurantId,
            planId: params.planId,
            billingCycle: params.billingCycle,
            customerEmail: params.customerEmail,
            customerName: params.customerName
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.orderId) {
            return {
              providerOrderId: data.orderId,
              amountPaise: data.amount || amountPaise,
              currency: data.currency || plan.currency,
              currencySymbol: plan.currencySymbol,
              provider: this.type,
              checkoutToken: data.orderId,
              keyId: data.keyId,
              planId: params.planId,
              billingCycle: params.billingCycle
            };
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          console.warn('[Razorpay Provider] Server order creation returned error:', errData);
          if (errData?.error === 'PRICE_MISMATCH' || errData?.error === 'INVALID_PLAN') {
            throw new Error(errData.message || 'Invalid plan or pricing.');
          }
        }
      }
    } catch (err: any) {
      if (err.message && (err.message.includes('Invalid plan') || err.message.includes('PRICE_MISMATCH'))) {
        throw err;
      }
      throw new Error(`Razorpay checkout unavailable: ${err?.message || 'server error'}`);
    }

    throw new Error('Razorpay checkout unavailable. No payment order was created.');
  }

  async verifyPayment(params: PaymentVerificationParams): Promise<PaymentVerificationResult> {
    if (!params.signature || params.signature.trim() === '') {
      return {
        verified: false,
        subscriptionId: '',
        transactionId: '',
        error: 'Missing payment signature verification token.'
      };
    }

    try {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : '';

      const isTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true');
      if (token && typeof window !== 'undefined' && window.fetch && !isTest) {
        const res = await fetch(getApiUrl('/api/subscription/verify-and-activate'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            restaurantId: params.restaurantId,
            planId: params.planId,
            billingCycle: params.billingCycle,
            razorpayOrderId: params.providerOrderId,
            razorpayPaymentId: params.paymentId,
            razorpaySignature: params.signature
          })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success && data.verified) {
          return {
            verified: true,
            subscriptionId: params.providerOrderId,
            transactionId: params.paymentId,
            subscription: data.subscription
          };
        } else {
          return {
            verified: false,
            subscriptionId: '',
            transactionId: '',
            error: data.message || 'Server payment signature verification rejected.'
          };
        }
      }
    } catch (err: any) {
      console.warn('[Razorpay Provider] Server verification endpoint call failed:', err);
    }

    return {
      verified: false,
      subscriptionId: '',
      transactionId: '',
      error: 'Invalid payment signature.'
    };
  }
}

/**
 * Mock Gateway Provider (Safe sandbox simulation).
 * Generates cryptographic-style simulated tokens without storing raw cards/credentials.
 */
export class MockSubscriptionGatewayProvider implements SubscriptionPaymentProvider {
  type: PaymentProviderType = 'mock_gateway';

  async createPaymentOrder(params: PaymentOrderParams): Promise<PaymentOrderResult> {
    const isTestRuntime = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true');
    if (!isTestRuntime) {
      throw new Error('Mock payment provider is disabled outside test environments.');
    }
    const plan = getPlanById(params.planId);
    const amountPaise =
      params.billingCycle === 'annual' ? plan.priceAnnualPaise : plan.priceMonthlyPaise;
    const orderRef = `ord_mock_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const checkoutToken = `tok_sim_${Math.random().toString(36).substring(2, 12)}`;

    return {
      providerOrderId: orderRef,
      amountPaise,
      currency: plan.currency,
      currencySymbol: plan.currencySymbol,
      provider: this.type,
      checkoutToken,
      planId: params.planId,
      billingCycle: params.billingCycle
    };
  }

  async verifyPayment(params: PaymentVerificationParams): Promise<PaymentVerificationResult> {
    const isTestRuntime = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true');
    if (!isTestRuntime) {
      return {
        verified: false,
        subscriptionId: '',
        transactionId: '',
        error: 'Mock payment provider is disabled outside test environments.'
      };
    }
    if (!params.signature || params.signature.trim() === '') {
      return {
        verified: false,
        subscriptionId: '',
        transactionId: '',
        error: 'Missing payment signature verification token'
      };
    }

    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    return {
      verified: true,
      subscriptionId: params.providerOrderId,
      transactionId: txId
    };
  }
}

export const razorpayPaymentProvider = new RazorpaySubscriptionPaymentProvider();
export const mockPaymentProvider = new MockSubscriptionGatewayProvider();

// Active default payment provider
export const defaultPaymentProvider: SubscriptionPaymentProvider = razorpayPaymentProvider;
