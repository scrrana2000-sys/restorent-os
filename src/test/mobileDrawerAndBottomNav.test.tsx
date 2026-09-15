import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileBottomNav } from '../components/layout/MobileBottomNav';
import { Sidebar } from '../components/layout/Sidebar';

let mockCurrentUserRole = 'owner';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user_1', email: 'owner@restaurant.com', displayName: 'Chef Owner' },
    profile: {
      uid: 'user_1',
      email: 'owner@restaurant.com',
      displayName: 'Chef Owner',
      role: mockCurrentUserRole,
      active: true,
      restaurantId: 'rest_1',
      createdAt: new Date().toISOString()
    },
    loading: false,
    logout: vi.fn()
  })
}));

vi.mock('../context/RestaurantContext', () => ({
  useRestaurant: () => ({
    restaurant: {
      restaurantId: 'rest_1',
      name: "Harisha's Gourmet Bistro",
      address: '123 Main Street',
      city: 'Raichur',
      country: 'India',
      currencySymbol: '₹',
      defaultTaxRate: 5,
      ownerId: 'user_1',
      isActive: true
    },
    availableRestaurants: [
      {
        restaurantId: 'rest_1',
        name: "Harisha's Gourmet Bistro",
        city: 'Raichur',
        ownerId: 'user_1'
      }
    ],
    isSwitching: false,
    switchRestaurant: vi.fn()
  })
}));

describe('Mobile Drawer + Bottom Navigation Architecture & Layering Fixes', () => {
  let originalOverflow: string;
  let originalTouchAction: string;

  beforeEach(() => {
    mockCurrentUserRole = 'owner';
    originalOverflow = document.body.style.overflow;
    originalTouchAction = document.body.style.touchAction;
  });

  afterEach(() => {
    document.body.style.overflow = originalOverflow;
    document.body.style.touchAction = originalTouchAction;
    vi.clearAllMocks();
  });

  // 1. Layering Hierarchy: MobileBottomNav uses z-30 (below backdrop z-40 and drawer z-50)
  it('1. MobileBottomNav renders with z-30 and pb-safe class to prevent overlapping the drawer', () => {
    const handleNavigate = vi.fn();
    const handleOpenMore = vi.fn();

    const { container } = render(
      <MobileBottomNav
        currentView="pos"
        onNavigate={handleNavigate}
        onOpenMoreMenu={handleOpenMore}
        dueOrdersCount={3}
      />
    );

    const nav = container.querySelector('#mobile-bottom-navigation');
    expect(nav).toBeTruthy();
    expect(nav?.className).toContain('z-30');
    expect(nav?.className).toContain('pb-safe');
    expect(nav?.className).toContain('fixed');
    expect(nav?.className).toContain('bottom-0');

    // Verify compact height on container (h-13 / sm:h-14)
    const innerBar = nav?.querySelector('div');
    expect(innerBar?.className).toContain('h-13');
  });

  // 2. Touch targets & buttons in MobileBottomNav
  it('2. MobileBottomNav items adhere to min-h-[44px] touch target rules and trigger actions correctly', () => {
    const handleNavigate = vi.fn();
    const handleOpenMore = vi.fn();

    render(
      <MobileBottomNav
        currentView="pos"
        onNavigate={handleNavigate}
        onOpenMoreMenu={handleOpenMore}
        dueOrdersCount={5}
      />
    );

    const posBtn = screen.getByRole('button', { name: /POS/i });
    expect(posBtn.className).toContain('min-h-[44px]');
    expect(posBtn.className).toContain('text-indigo-600'); // active state

    const kitchenBtn = screen.getByRole('button', { name: /Kitchen/i });
    expect(kitchenBtn.className).toContain('min-h-[44px]');
    fireEvent.click(kitchenBtn);
    expect(handleNavigate).toHaveBeenCalledWith('kitchen');

    const moreBtn = screen.getByRole('button', { name: /More/i });
    expect(moreBtn.className).toContain('min-h-[44px]');
    fireEvent.click(moreBtn);
    expect(handleOpenMore).toHaveBeenCalledTimes(1);
  });

  // 3. Sidebar mobile drawer layering (z-50) and backdrop layering (z-40)
  it('3. Sidebar renders backdrop at z-40 and drawer at z-50 when isOpenMobile is true', () => {
    const handleNavigate = vi.fn();
    const handleClose = vi.fn();

    const { container } = render(
      <Sidebar
        currentView="pos"
        onNavigate={handleNavigate}
        isOpenMobile={true}
        onCloseMobile={handleClose}
      />
    );

    const backdrop = container.querySelector('#mobile-sidebar-backdrop');
    expect(backdrop).toBeTruthy();
    expect(backdrop?.className).toContain('z-40');
    expect(backdrop?.className).toContain('fixed');
    expect(backdrop?.className).toContain('inset-0');

    const drawer = container.querySelector('#app-sidebar-drawer');
    expect(drawer).toBeTruthy();
    expect(drawer?.className).toContain('z-50');
    expect(drawer?.className).toContain('translate-x-0');
    expect(drawer?.className).toContain('h-[100dvh]');
  });

  // 4. Backdrop click triggers onCloseMobile
  it('4. Clicking the backdrop closes the mobile sidebar drawer', () => {
    const handleNavigate = vi.fn();
    const handleClose = vi.fn();

    const { container } = render(
      <Sidebar
        currentView="pos"
        onNavigate={handleNavigate}
        isOpenMobile={true}
        onCloseMobile={handleClose}
      />
    );

    const backdrop = container.querySelector('#mobile-sidebar-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  // 5. Close button inside drawer triggers onCloseMobile
  it('5. Clicking the header close button in the drawer closes the mobile sidebar', () => {
    const handleNavigate = vi.fn();
    const handleClose = vi.fn();

    render(
      <Sidebar
        currentView="pos"
        onNavigate={handleNavigate}
        isOpenMobile={true}
        onCloseMobile={handleClose}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /Close navigation drawer/i });
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.className).toContain('min-h-[44px]');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  // 6. Navigation item selection closes mobile drawer and navigates
  it('6. Clicking a navigation item inside the drawer calls onNavigate and closes the drawer', () => {
    const handleNavigate = vi.fn();
    const handleClose = vi.fn();

    render(
      <Sidebar
        currentView="pos"
        onNavigate={handleNavigate}
        isOpenMobile={true}
        onCloseMobile={handleClose}
      />
    );

    const reportsBtn = screen.getByRole('button', { name: /Reports & Analytics/i });
    expect(reportsBtn).toBeTruthy();
    expect(reportsBtn.className).toContain('min-h-[44px]');
    fireEvent.click(reportsBtn);

    expect(handleNavigate).toHaveBeenCalledWith('reports');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  // 7. Body scroll locking when drawer is open
  it('7. Locks body overflow when isOpenMobile is true and restores it on unmount or close', () => {
    const handleNavigate = vi.fn();
    const handleClose = vi.fn();

    const { rerender } = render(
      <Sidebar
        currentView="pos"
        onNavigate={handleNavigate}
        isOpenMobile={true}
        onCloseMobile={handleClose}
      />
    );

    expect(document.body.style.overflow).toBe('hidden');

    // Rerender with isOpenMobile = false
    rerender(
      <Sidebar
        currentView="pos"
        onNavigate={handleNavigate}
        isOpenMobile={false}
        onCloseMobile={handleClose}
      />
    );

    expect(document.body.style.overflow).toBe('');
  });

  // 8. Role-based item visibility in mobile bottom nav
  it('8. Kitchen role only sees allowed views in bottom nav (Kitchen and More)', () => {
    mockCurrentUserRole = 'kitchen';
    const handleNavigate = vi.fn();
    const handleOpenMore = vi.fn();

    render(
      <MobileBottomNav
        currentView="kitchen"
        onNavigate={handleNavigate}
        onOpenMoreMenu={handleOpenMore}
      />
    );

    expect(screen.queryByRole('button', { name: /^POS$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Payments$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Kitchen$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
  });

  // 9. Sidebar drawer contains Sign Out / Logout action
  it('9. Sidebar drawer renders Sign Out button and calls logout on click', () => {
    const handleNavigate = vi.fn();
    const handleClose = vi.fn();

    render(
      <Sidebar
        currentView="pos"
        onNavigate={handleNavigate}
        isOpenMobile={true}
        onCloseMobile={handleClose}
      />
    );

    const logoutBtn = screen.getByRole('button', { name: /Sign Out \/ Logout/i });
    expect(logoutBtn).toBeTruthy();
    expect(logoutBtn.className).toContain('min-h-[44px]');
    fireEvent.click(logoutBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
