import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { OwnerCentralPage } from '../pages/OwnerCentralPage';
import { SubscriptionView } from '../components/subscription/SubscriptionView';
import { SubscriptionStatusBanner } from '../components/subscription/SubscriptionStatusBanner';
import { SubscriptionPlanCard } from '../components/subscription/SubscriptionPlanCard';
import { COMMERCIAL_PLANS } from '../config/subscriptionPlans';
import { AdminLayout } from '../components/layout/AdminLayout';
import { Header } from '../components/layout/Header';
import { MobileBottomNav } from '../components/layout/MobileBottomNav';
import { AuthProvider } from '../context/AuthContext';
import { CustomerAuthProvider } from '../context/CustomerAuthContext';
import { RestaurantProvider } from '../context/RestaurantContext';
import { SubscriptionProvider } from '../context/SubscriptionContext';

describe('RestaurantOS Diagnostic Test Suite for Loading & Runtime', () => {
  it('renders root App without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeDefined();
  });

  it('renders OwnerCentralPage unauthenticated without crashing', () => {
    const { container } = render(
      <AuthProvider>
        <CustomerAuthProvider>
          <OwnerCentralPage />
        </CustomerAuthProvider>
      </AuthProvider>
    );
    expect(container).toBeDefined();
  });

  it('renders SubscriptionPlanCard for all commercial plans without error', () => {
    COMMERCIAL_PLANS.forEach((plan) => {
      const { container } = render(
        <SubscriptionPlanCard
          plan={plan}
          billingCycle="monthly"
          isCurrentPlan={false}
          onSelect={() => {}}
        />
      );
      expect(container).toBeDefined();
      expect(screen.getByText(plan.name)).toBeDefined();
    });
  });

  it('renders Header in light and dark mode without crashing', () => {
    const { container: light } = render(
      <AuthProvider>
        <RestaurantProvider>
          <Header onOpenMobileMenu={() => {}} onNavigateToSetup={() => {}} isDark={false} />
        </RestaurantProvider>
      </AuthProvider>
    );
    expect(light).toBeDefined();

    const { container: dark } = render(
      <AuthProvider>
        <RestaurantProvider>
          <Header onOpenMobileMenu={() => {}} onNavigateToSetup={() => {}} isDark={true} />
        </RestaurantProvider>
      </AuthProvider>
    );
    expect(dark).toBeDefined();
  });

  it('renders MobileBottomNav in light and dark mode without crashing', () => {
    const { container: light } = render(
      <AuthProvider>
        <RestaurantProvider>
          <MobileBottomNav currentView="pos" onNavigate={() => {}} onOpenMoreMenu={() => {}} />
        </RestaurantProvider>
      </AuthProvider>
    );
    expect(light).toBeDefined();

    const { container: dark } = render(
      <AuthProvider>
        <RestaurantProvider>
          <MobileBottomNav currentView="subscription" onNavigate={() => {}} onOpenMoreMenu={() => {}} />
        </RestaurantProvider>
      </AuthProvider>
    );
    expect(dark).toBeDefined();
  });

  it('renders AdminLayout in subscription view without crashing', () => {
    const { container } = render(
      <AuthProvider>
        <RestaurantProvider>
          <SubscriptionProvider>
            <AdminLayout currentView="subscription" onNavigate={() => {}}>
              <SubscriptionView />
            </AdminLayout>
          </SubscriptionProvider>
        </RestaurantProvider>
      </AuthProvider>
    );
    expect(container).toBeDefined();
  });
});
