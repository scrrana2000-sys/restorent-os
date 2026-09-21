/**
 * RestaurantOS Subscription Context & Provider
 *
 * Provides real-time reactive subscription state, trial tracking,
 * feature entitlements, and payment checkout orchestration.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import {
  BillingCycle,
  RestaurantSubscription,
  SubscriptionEntitlements,
  SubscriptionHistoryRecord,
  PlanLimits
} from '../types/subscription';
import { useRestaurant } from './RestaurantContext';
import {
  ensureRestaurantTrial,
  getRestaurantSubscription,
  getSubscriptionHistoryOnce,
  activatePaidSubscription
} from '../services/subscriptionService';
import {
  evaluateSubscriptionEntitlements,
  isFeatureEntitled
} from '../utils/subscriptionEntitlements';
import { defaultPaymentProvider, loadRazorpayScript } from '../services/subscriptionPaymentService';
import { getPlanById } from '../config/subscriptionPlans';

interface SubscriptionContextType {
  subscription: RestaurantSubscription | null;
  history: SubscriptionHistoryRecord[];
  entitlements: SubscriptionEntitlements;
  isFeatureEnabled: (feature: keyof PlanLimits) => boolean;
  loading: boolean;
  error: string | null;
  isProcessing: boolean;
  selectedPlanModal: { planId: string; cycle: BillingCycle } | null;
  openPaymentModal: (planId: string, cycle?: BillingCycle) => void;
  closePaymentModal: () => void;
  processPaymentAndActivate: (planId: string, cycle: BillingCycle) => Promise<boolean>;
  refreshSubscription: () => Promise<void>;
  loadSubscriptionHistory: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { restaurant } = useRestaurant();
  const restaurantId = restaurant?.restaurantId;

  const [subscription, setSubscription] = useState<RestaurantSubscription | null>(null);
  const [history, setHistory] = useState<SubscriptionHistoryRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [selectedPlanModal, setSelectedPlanModal] = useState<{ planId: string; cycle: BillingCycle } | null>(null);

  // Compute entitlements memoized
  const entitlements = useMemo(() => {
    return evaluateSubscriptionEntitlements(subscription);
  }, [subscription]);

  // Load the current subscription once. The owner console does not keep a
  // subscription or billing-history listener alive while other pages are open.
  useEffect(() => {
    if (!restaurantId) {
      setSubscription(null);
      setHistory([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let current = await getRestaurantSubscription(restaurantId);

        // Backfill/initialize only when the document is missing or incomplete.
        if (!current || !current.operationalAccessUntil) {
          try {
            current = await ensureRestaurantTrial(restaurantId);
          } catch (trialErr: any) {
            console.warn('[SubscriptionContext] Trial initialization notice:', trialErr?.message || trialErr);
          }
        }

        if (isMounted) {
          setSubscription(current);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          console.warn('[SubscriptionContext] Subscription read notice:', err);
          setError(err?.message || 'Unable to load subscription status.');
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [restaurantId]);


  const openPaymentModal = useCallback((planId: string, cycle: BillingCycle = 'annual') => {
    setSelectedPlanModal({ planId, cycle });
  }, []);

  const closePaymentModal = useCallback(() => {
    setSelectedPlanModal(null);
  }, []);

  const processPaymentAndActivate = useCallback(
    async (planId: string, cycle: BillingCycle): Promise<boolean> => {
      if (!restaurantId) return false;
      setIsProcessing(true);
      setError(null);

      try {
        const targetPlan = getPlanById(planId);

        // 1. Authoritatively create order (server computes price, verifies permissions)
        let order: any;
        try {
          order = await defaultPaymentProvider.createPaymentOrder({
            restaurantId,
            planId,
            billingCycle: cycle,
            customerEmail: restaurant?.email || undefined,
            customerName: restaurant?.name || undefined
          });
        } catch (orderErr: any) {
          console.warn('[SubscriptionContext] Payment order creation notice:', orderErr);
          if (process.env.NODE_ENV !== 'production') {
            order = {
              providerOrderId: `order_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              amountPaise: cycle === 'annual' ? targetPlan.priceAnnualPaise : targetPlan.priceMonthlyPaise,
              currency: targetPlan.currency || 'INR',
              currencySymbol: targetPlan.currencySymbol || '₹',
              provider: 'razorpay',
              checkoutToken: `tok_sim_${Date.now()}`,
              keyId: 'rzp_test_placeholder',
              planId,
              billingCycle: cycle
            };
          } else {
            throw orderErr;
          }
        }

        // 2. If running in a browser with Razorpay support, attempt interactive checkout
        const hasWindow = typeof window !== 'undefined';
        let razorpayCheckoutOpened = false;

        if (hasWindow && order.keyId && order.keyId !== 'rzp_test_placeholder') {
          const loaded = await loadRazorpayScript();
          if (loaded && window.Razorpay) {
            razorpayCheckoutOpened = true;

            return new Promise<boolean>((resolve) => {
              const options = {
                key: order.keyId,
                amount: order.amountPaise,
                currency: order.currency || 'INR',
                name: 'RestaurantOS',
                description: `${targetPlan.name} Subscription (${cycle})`,
                order_id: order.providerOrderId,
                prefill: {
                  name: restaurant?.name || '',
                  email: restaurant?.email || ''
                },
                theme: {
                  color: '#4f46e5'
                },
                handler: async (response: any) => {
                  try {
                    const result = await activatePaidSubscription({
                      restaurantId,
                      planId,
                      billingCycle: cycle,
                      providerOrderId: response.razorpay_order_id || order.providerOrderId,
                      paymentId: response.razorpay_payment_id,
                      signature: response.razorpay_signature
                    });

                    if (result.success) {
                      setSubscription(result.subscription);
                      closePaymentModal();
                      resolve(true);
                    } else {
                      setError('Subscription activation could not be verified.');
                      resolve(false);
                    }
                  } catch (activationErr: any) {
                    setError(activationErr?.message || 'Payment verification failed.');
                    resolve(false);
                  } finally {
                    setIsProcessing(false);
                  }
                },
                modal: {
                  ondismiss: () => {
                    setIsProcessing(false);
                    resolve(false);
                  }
                }
              };

              try {
                const rzp = new window.Razorpay(options);
                rzp.on('payment.failed', (resp: any) => {
                  setIsProcessing(false);
                  setError(resp.error?.description || 'Payment was unsuccessful. Please try again.');
                  resolve(false);
                });
                rzp.open();
              } catch (rzpErr: any) {
                console.warn('[SubscriptionContext] Razorpay modal launch notice:', rzpErr);
                razorpayCheckoutOpened = false;
              }
            });
          }
        }

        // 3. Fallback path (Sandbox / Test simulation mode)
        const paymentId = `pay_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const signature = `sig_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const result = await activatePaidSubscription({
          restaurantId,
          planId,
          billingCycle: cycle,
          providerOrderId: order.providerOrderId,
          paymentId,
          signature
        });

        if (result.success) {
          setSubscription(result.subscription);
          closePaymentModal();
          return true;
        }
        return false;
      } catch (err: any) {
        console.error('[SubscriptionContext] Activation failed:', err);
        setError(err.message || 'Subscription activation failed. Please try again.');
        return false;
      } finally {
        setIsProcessing(false);
      }
    },
    [restaurantId, restaurant, closePaymentModal]
  );

  const refreshSubscription = useCallback(async () => {
    if (!restaurantId) return;
    try {
      let current = await getRestaurantSubscription(restaurantId);
      if (!current || !current.operationalAccessUntil) {
        current = await ensureRestaurantTrial(restaurantId);
      }
      setSubscription(current);
    } catch (err) {
      console.warn('[SubscriptionContext] Refresh warning:', err);
    }
  }, [restaurantId]);

  const loadSubscriptionHistory = useCallback(async () => {
    if (!restaurantId) {
      setHistory([]);
      return;
    }
    try {
      const records = await getSubscriptionHistoryOnce(restaurantId);
      setHistory(records);
    } catch (err) {
      console.warn('[SubscriptionContext] History load warning:', err);
      setHistory([]);
    }
  }, [restaurantId]);

  const isFeatureEnabled = useCallback(
    (feature: keyof PlanLimits): boolean => {
      return isFeatureEntitled(entitlements, feature);
    },
    [entitlements]
  );

  const value = useMemo(
    () => ({
      subscription,
      history,
      entitlements,
      isFeatureEnabled,
      loading,
      error,
      isProcessing,
      selectedPlanModal,
      openPaymentModal,
      closePaymentModal,
      processPaymentAndActivate,
      refreshSubscription,
      loadSubscriptionHistory
    }),
    [
      subscription,
      history,
      entitlements,
      isFeatureEnabled,
      loading,
      error,
      isProcessing,
      selectedPlanModal,
      openPaymentModal,
      closePaymentModal,
      processPaymentAndActivate,
      refreshSubscription,
      loadSubscriptionHistory
    ]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
};

export const useSubscription = (): SubscriptionContextType => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
};
