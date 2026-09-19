/**
 * RestaurantOS Subscription & Billing Types
 *
 * Defines the core models for restaurant subscriptions, 7-day trials,
 * plan configurations, billing cycles, and payment audit logs.
 */

export type SubscriptionStatus =
  | 'trial'             // Active 7-day free trial
  | 'active'            // Active paid subscription
  | 'trial_expired'     // 7-day free trial has elapsed without active plan
  | 'expired'           // Paid subscription period has elapsed
  | 'payment_pending'   // Payment transaction initiated and awaiting gateway settlement
  | 'grace_period';     // Temporary grace window before full operational restriction

export type BillingCycle = 'monthly' | 'annual';

export type PaymentProviderType = 'mock_gateway' | 'razorpay' | 'stripe' | 'manual';

export type SubscriptionHistoryEventType =
  | 'TRIAL_STARTED'
  | 'CHECKOUT_CREATED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'SUBSCRIPTION_ACTIVATED'
  | 'PLAN_CHANGED'
  | 'SUBSCRIPTION_RENEWED'
  | 'SUBSCRIPTION_CANCELLED'
  | 'SUBSCRIPTION_EXPIRED';

export interface PlanLimits {
  maxTables: number;
  maxStaff: number;
  multiDevice: boolean;
  onlineOrdering: boolean;
  inventoryManagement: boolean;
  reportsAnalytics: boolean;
  voiceAssistant: boolean;
  kitchenDisplay?: boolean;
  captainHandheld?: boolean;
  customerCrm?: boolean;
  thermalPrinterRouting?: boolean;
}

export interface SubscriptionPlan {
  planId: string;
  id?: string;              // Compatibility alias for centralized plan configuration
  name: string;
  tagline: string;
  price?: number;           // Standard rupee unit (e.g. 299, 699, 999)
  priceMonthlyPaise: number; // In minor units (paise)
  priceAnnualPaise: number;  // In minor units (paise)
  currency: string;
  currencySymbol: string;
  billingCycle?: BillingCycle;
  features: string[];
  limits: PlanLimits;
  active: boolean;
  isPopular?: boolean;
}

export interface RestaurantSubscription {
  subscriptionId: string;
  restaurantId: string;
  status: SubscriptionStatus;
  planId: string;
  planName?: string;
  billingCycle: BillingCycle;
  amount?: number;        // in paise (minor units)
  currency?: string;      // e.g. 'INR'
  trialStartedAt: string; // ISO 8601 string
  trialEndsAt: string;    // ISO 8601 string (strictly 7 days after trialStartedAt)
  trialStartAt?: string;  // Alias
  trialEndAt?: string;    // Alias
  currentPeriodStart: string; // ISO 8601 string
  currentPeriodEnd: string;   // ISO 8601 string
  paymentStatus: 'none' | 'paid' | 'pending' | 'failed';
  provider: PaymentProviderType;
  providerSubscriptionId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySubscriptionId?: string;
  activatedAt?: string;
  lastPaymentAmount?: number; // in paise
  lastPaymentDate?: string;
  autoRenew: boolean;
  /**
   * Firestore Timestamp used by Security Rules as the authoritative operational
   * entitlement boundary. Kept separate from the legacy ISO-string date fields
   * used by the UI.
   */
  operationalAccessUntil?: any;
  createdAt: any;
  updatedAt: any;
}

export interface SubscriptionHistoryRecord {
  id: string;
  restaurantId: string;
  planId: string;
  planName: string;
  billingCycle: BillingCycle;
  amount: number; // in paise
  currency: string;
  status: 'paid' | 'failed' | 'pending' | 'refunded';
  eventType?: SubscriptionHistoryEventType;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  periodStart?: string;
  periodEnd?: string;
  provider: PaymentProviderType;
  paymentReference: string;
  timestamp: string;
  metadata?: Record<string, any>;
  createdAt: any;
}

export interface SubscriptionEntitlements {
  status: SubscriptionStatus;
  hasActiveSubscription: boolean;
  hasValidTrial: boolean;
  isSubscriptionExpired: boolean;
  isExpiringSoon: boolean;
  daysRemaining: number;
  hoursRemaining: number;
  canPerformOperationalActions: boolean;
  plan: SubscriptionPlan;
}
