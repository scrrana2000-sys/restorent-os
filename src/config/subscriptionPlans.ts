/**
 * RestaurantOS Centralized Subscription Plans & Customization Configuration
 *
 * Configurable plan definitions, feature flags, limits, and monthly pricing.
 * Prices are declared in both standard units (rupees) and minor units (paise)
 * to ensure cryptographic and accounting precision.
 */

import { SubscriptionPlan } from '../types/subscription';

export const TRIAL_PLAN_ID = 'trial_7d';

export interface CustomizationPlanConfig {
  id: string;
  heading: string;
  title: string;
  description: string;
  buttonText: string;
  contactEmail: string;
  mailtoUrl: string;
}

/**
 * Centralized Customization Configuration
 * Dedicated solution tier for bespoke integrations, custom branding, or special restaurant needs.
 * NOT a standard self-serve checkout plan.
 */
export const CUSTOMIZATION_CONFIG: CustomizationPlanConfig = {
  id: 'customization',
  heading: 'Need a Custom Solution?',
  title: 'Customization',
  description: 'For restaurants/businesses requiring custom features, integrations, branding or special requirements.',
  buttonText: 'Contact Us',
  contactEmail: 'radhachawan01@gmail.com',
  mailtoUrl: 'mailto:radhachawan01@gmail.com?subject=RestaurantOS%20Customization%20Inquiry'
};

/**
 * Centralized Commercial & Trial Subscription Plans
 * Strict Display Order: Starter (₹299) -> Growth (₹699) -> Pro (₹999)
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    planId: 'trial_7d',
    id: 'trial_7d',
    name: '7-Day Free Trial',
    tagline: 'Complete access to all RestaurantOS features for 7 days',
    price: 0,
    priceMonthlyPaise: 0,
    priceAnnualPaise: 0,
    currency: 'INR',
    currencySymbol: '₹',
    billingCycle: 'monthly',
    features: [
      'Full POS & Table Management',
      'Real-time Kitchen Display & KOT',
      'Inventory & Recipe Tracking',
      'Online Customer Ordering & QR Menu',
      'Customer CRM & Analytics',
      'Voice Assistant Support'
    ],
    limits: {
      maxTables: 50,
      maxStaff: 20,
      multiDevice: true,
      onlineOrdering: true,
      inventoryManagement: true,
      reportsAnalytics: true,
      voiceAssistant: true
    },
    active: true
  },
  {
    planId: 'starter',
    id: 'starter',
    name: 'Starter',
    tagline: 'Essential digital tools for cafes, bakeries, and small diners',
    price: 299,
    priceMonthlyPaise: 29900, // ₹299.00 / month
    priceAnnualPaise: 358800,  // ₹3,588.00 / year (299 * 12)
    currency: 'INR',
    currencySymbol: '₹',
    billingCycle: 'monthly',
    features: [
      'Single-Station POS Terminal',
      'Kitchen Order Ticket (KOT) Generation',
      'Digital QR Menu & Dine-in Billing',
      'Daily Revenue & Sales Reports',
      'Receipt & Bill Printing',
      'Standard Email Support'
    ],
    limits: {
      maxTables: 15,
      maxStaff: 5,
      multiDevice: false,
      onlineOrdering: false,
      inventoryManagement: false,
      reportsAnalytics: true,
      voiceAssistant: false
    },
    active: true
  },
  {
    planId: 'growth',
    id: 'growth',
    name: 'Growth',
    tagline: 'Comprehensive operating system for growing restaurants & cafes',
    price: 699,
    priceMonthlyPaise: 69900, // ₹699.00 / month
    priceAnnualPaise: 838800,  // ₹8,388.00 / year (699 * 12)
    currency: 'INR',
    currencySymbol: '₹',
    billingCycle: 'monthly',
    features: [
      'Multi-Device POS & Captain Handhelds',
      'Live Kitchen Display System (KDS)',
      'Raw Material Inventory & Recipe Depletion',
      'Customer CRM, History & Loyalty Insights',
      'Public Online Ordering Front Door',
      'Thermal Printer Auto-Routing (KOT/Bill)',
      'Daily Revenue & Expense Analytics',
      'Standard Support'
    ],
    limits: {
      maxTables: 50,
      maxStaff: 15,
      multiDevice: true,
      onlineOrdering: true,
      inventoryManagement: true,
      reportsAnalytics: true,
      voiceAssistant: false
    },
    active: true
  },
  {
    planId: 'pro',
    id: 'pro',
    name: 'Pro',
    tagline: 'Advanced operating system with Voice AI, multi-station scale & priority support',
    price: 999,
    priceMonthlyPaise: 99900, // ₹999.00 / month
    priceAnnualPaise: 1198800, // ₹11,988.00 / year (999 * 12)
    currency: 'INR',
    currencySymbol: '₹',
    billingCycle: 'monthly',
    features: [
      'Unlimited POS & Captain Handheld Stations',
      'Live Kitchen Display System (KDS) & Routing',
      'Full Recipe-Level Inventory & Batch Tracking',
      'Customer CRM, Loyalty & Lifetime Analytics',
      'Public Online Ordering & Digital QR Menus',
      'Thermal Printer Routing for Bills & KOTs',
      'Voice Assistant Hands-Free POS',
      'Priority Phone & WhatsApp Support'
    ],
    limits: {
      maxTables: 100,
      maxStaff: 50,
      multiDevice: true,
      onlineOrdering: true,
      inventoryManagement: true,
      reportsAnalytics: true,
      voiceAssistant: true
    },
    active: true,
    isPopular: true
  }
];

/**
 * Filtered list of commercial paid plans in exact required order:
 * Starter (₹299) -> Growth (₹699) -> Pro (₹999)
 */
export const COMMERCIAL_PLANS: SubscriptionPlan[] = SUBSCRIPTION_PLANS.filter(
  (plan) => plan.planId !== TRIAL_PLAN_ID
);

export function getPlanById(planId: string): SubscriptionPlan {
  const plan = SUBSCRIPTION_PLANS.find((p) => p.planId === planId || p.id === planId);
  if (!plan) {
    if (planId === 'enterprise') {
      return SUBSCRIPTION_PLANS.find((p) => p.planId === 'pro') || SUBSCRIPTION_PLANS[0];
    }
    // Default to Pro if unknown
    return SUBSCRIPTION_PLANS.find((p) => p.planId === 'pro') || SUBSCRIPTION_PLANS[0];
  }
  return plan;
}

export function formatPlanPrice(amountPaise: number, currencySymbol: string = '₹'): string {
  const rupees = Math.round(amountPaise / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 0
  });
  return `${currencySymbol}${rupees}`;
}
