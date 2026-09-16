import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublicCustomerDiscoveryPage } from '../pages/PublicCustomerDiscoveryPage';
import { CustomerLocationProvider } from '../context/CustomerLocationContext';
import { CustomerLocationSelectorModal } from '../components/customer/CustomerLocationSelectorModal';
import { CustomerSidebarDrawer } from '../components/customer/CustomerSidebarDrawer';

describe('Customer UI Fix - Header, Location Modal & Left Side Drawer', () => {
  it('renders Header with Cart Button on top right and NO location button in top right header', () => {
    const { container } = render(<PublicCustomerDiscoveryPage />);
    
    // Header cart button should be present
    const headerCartBtn = container.querySelector('#header-cart-trigger-btn');
    expect(headerCartBtn).not.toBeNull();

    // Verify there is no duplicate location bar or location label text in header
    const locationLabels = screen.queryAllByText(/Location:/i);
    expect(locationLabels.length).toBe(0);
  });

  it('renders RESTAURANTS NEAR title row with icon-only location and icon-only filter buttons', () => {
    const { container } = render(<PublicCustomerDiscoveryPage />);

    // Location icon-only button next to title
    const locationBtn = container.querySelector('#customer-location-trigger-btn');
    expect(locationBtn).not.toBeNull();
    // Location button must NOT contain visible text like 'Bengaluru' or 'Location'
    expect(locationBtn?.textContent?.trim()).toBe('');

    // Filter icon-only button next to location button
    const filterBtn = container.querySelector('#toggle-filters-btn');
    expect(filterBtn).not.toBeNull();
    // Filter button must NOT contain visible text like 'Filters' or 'Filter'
    expect(filterBtn?.textContent?.trim()).toBe('');
  });

  it('opens Location Selector Modal when location icon button is clicked', async () => {
    const { container } = render(<PublicCustomerDiscoveryPage />);

    const locationBtn = container.querySelector('#customer-location-trigger-btn');
    expect(locationBtn).not.toBeNull();

    fireEvent.click(locationBtn!);

    // Verify modal overlay opens with z-[100] above page
    const modal = container.querySelector('#customer-location-selector-modal');
    expect(modal).not.toBeNull();
    expect(modal?.classList.contains('z-[100]')).toBe(true);

    // Verify close button closes modal
    const closeBtn = container.querySelector('#close-location-modal-btn');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);

    await waitFor(() => {
      expect(container.querySelector('#customer-location-selector-modal')).toBeNull();
    });
  });

  it('renders CustomerLocationSelectorModal with backdrop overlay and handles Escape key', () => {
    let closed = false;
    const { container } = render(
      <CustomerLocationProvider autoDetectOnMount={false}>
        <CustomerLocationSelectorModal isOpen={true} onClose={() => { closed = true; }} />
      </CustomerLocationProvider>
    );

    const modal = container.querySelector('#customer-location-selector-modal');
    expect(modal).not.toBeNull();

    // Escape key press
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(true);
  });

  it('opens Left Side Drawer when header menu trigger button is clicked', async () => {
    const { container } = render(<PublicCustomerDiscoveryPage />);

    const triggerBtn = container.querySelector('#customer-sidebar-trigger-btn');
    expect(triggerBtn).not.toBeNull();

    fireEvent.click(triggerBtn!);

    // Drawer should open sliding from left
    const drawer = container.querySelector('#customer-sidebar-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer?.classList.contains('slide-in-from-left')).toBe(true);

    // Navigation links should exist inside drawer
    expect(container.querySelector('#sidebar-nav-home')).not.toBeNull();
    expect(container.querySelector('#sidebar-nav-orders')).not.toBeNull();
    expect(container.querySelector('#sidebar-nav-profile')).not.toBeNull();
    expect(container.querySelector('#sidebar-nav-location')).not.toBeNull();

    // Close drawer
    const closeBtn = container.querySelector('#close-sidebar-drawer-btn');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);

    await waitFor(() => {
      expect(container.querySelector('#customer-sidebar-drawer')).toBeNull();
    });
  });
});
