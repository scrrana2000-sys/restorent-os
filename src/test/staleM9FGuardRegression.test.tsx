import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomerRestaurantPage } from '../pages/customer/CustomerRestaurantPage';
import { CustomerRestaurantMenuPage } from '../pages/customer/CustomerRestaurantMenuPage';
import { PublicCustomerDiscoveryPage } from '../pages/PublicCustomerDiscoveryPage';
import { CustomerCartProvider } from '../context/CustomerCartContext';
import { PublicRestaurantProfile } from '../types/customer';
import { Category, MenuItem } from '../types/menu';
import { organizePublicMenu } from '../services/customerMenuService';

// Mock Firebase Firestore
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    collection: vi.fn((_db, _restaurants, _id, subcol) => ({ _subcol: subcol })),
    doc: vi.fn(),
    query: vi.fn((ref) => ref),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    onSnapshot: vi.fn()
  };
});

import { getDocs, onSnapshot } from 'firebase/firestore';

const mockProfileA: PublicRestaurantProfile = {
  restaurantId: 'rest-tenant-a',
  publicSlug: 'harisha-restaurant',
  publicRestaurantCode: 'R-HAR01',
  name: "Harisha's Restaurant",
  legalName: "Harisha's Foods Private Limited",
  logoUrl: 'https://example.com/logo-a.jpg',
  coverImageUrl: 'https://example.com/cover-a.jpg',
  phone: '+91 98765 00001',
  address: 'Indiranagar 100ft Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  area: 'Indiranagar',
  postalCode: '560038',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['South Indian', 'Biryani'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockProfileB: PublicRestaurantProfile = {
  restaurantId: 'rest-tenant-b',
  publicSlug: 'royal-tandoor',
  publicRestaurantCode: 'R-ROY02',
  name: 'Royal Tandoor',
  logoUrl: null,
  coverImageUrl: null,
  phone: '+91 98765 00002',
  address: 'Koramangala 5th Block',
  city: 'Bengaluru',
  state: 'Karnataka',
  area: 'Koramangala',
  postalCode: '560095',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['North Indian', 'Tandoori'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockCategoriesA: Category[] = [
  {
    categoryId: 'cat-breakfast',
    restaurantId: 'rest-tenant-a',
    name: 'Breakfast Specials',
    description: 'Hot authentic morning meals',
    imageUrl: null,
    sortOrder: 1,
    isActive: true
  }
];

const mockItemsA: MenuItem[] = [
  {
    itemId: 'item-masala-dosa',
    restaurantId: 'rest-tenant-a',
    categoryId: 'cat-breakfast',
    name: 'Butter Masala Dosa',
    shortName: null,
    description: 'Crispy golden crepe filled with spiced potato masala',
    price: 120, // ₹120.00
    foodType: 'veg',
    isAvailable: true,
    imageUrl: null,
    taxRate: 0,
    taxInclusive: true,
    sku: null,
    sortOrder: 1
  }
];

const mockCategoriesB: Category[] = [
  {
    categoryId: 'cat-starters-b',
    restaurantId: 'rest-tenant-b',
    name: 'Tandoori Kebabs',
    description: 'Fresh from clay oven',
    imageUrl: null,
    sortOrder: 1,
    isActive: true
  }
];

const mockItemsB: MenuItem[] = [
  {
    itemId: 'item-paneer-tikka',
    restaurantId: 'rest-tenant-b',
    categoryId: 'cat-starters-b',
    name: 'Paneer Tikka Charcoal',
    shortName: null,
    description: 'Marinated cottage cheese grilled to perfection',
    price: 240, // ₹240.00
    foodType: 'veg',
    isAvailable: true,
    imageUrl: null,
    taxRate: 0,
    taxInclusive: true,
    sku: null,
    sortOrder: 1
  }
];

describe('Stale M9-F Guard Regression & Menu Isolation Verification Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (onSnapshot as any).mockImplementation((q: any, onNext: any) => {
      const subcol = q?._subcol || '';
      if (subcol === 'categories') {
        onNext({
          forEach: (cb: any) => mockCategoriesA.forEach((cat) => cb({ id: cat.categoryId, data: () => cat }))
        });
      } else if (subcol === 'items') {
        onNext({
          forEach: (cb: any) => mockItemsA.forEach((itm) => cb({ id: itm.itemId, data: () => itm }))
        });
      } else {
        onNext({ forEach: () => {} });
      }
      return () => {};
    });

    (getDocs as any).mockImplementation(async (q: any) => {
      const subcol = q?._subcol || '';
      if (subcol === 'categories') {
        return {
          forEach: (cb: any) => mockCategoriesA.forEach((cat) => cb({ id: cat.categoryId, data: () => cat }))
        };
      }
      if (subcol === 'items') {
        return {
          forEach: (cb: any) => mockItemsA.forEach((itm) => cb({ id: itm.itemId, data: () => itm }))
        };
      }
      return { forEach: () => {} };
    });
  });

  it('1. Public restaurant page does NOT show M9-F coming-soon popup', async () => {
    render(<CustomerRestaurantPage initialProfile={mockProfileA} />);

    // Click View Menu
    fireEvent.click(screen.getByText('View Menu'));

    // Assert that the old M9-F notice is completely gone
    expect(screen.queryByText(/Public menu browsing and customer food ordering will be activated in the upcoming Milestone/i)).toBeNull();
    expect(screen.queryByText(/M9-F/i)).toBeNull();
  });

  it('2. Existing restaurant menu loads and displays restaurant name', async () => {
    render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

    expect(await screen.findByText("Harisha's Restaurant")).toBeInTheDocument();
  });

  it('3. Categories load for selected restaurant', async () => {
    render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

    expect(await screen.findByText('Breakfast Specials')).toBeInTheDocument();
  });

  it('4. Items load for selected restaurant', async () => {
    render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

    expect(await screen.findByText('Butter Masala Dosa')).toBeInTheDocument();
  });

  it('5. Prices displayed from authoritative menu data', async () => {
    render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

    expect(await screen.findByText(/120/)).toBeInTheDocument();
  });

  it('6 & 7 & 8. Restaurant A shows A menu and Restaurant B shows B menu without cross-restaurant leakage', async () => {
    // Test A
    (onSnapshot as any).mockImplementation((q: any, onNext: any) => {
      const subcol = q?._subcol || '';
      if (subcol === 'categories') {
        onNext({ forEach: (cb: any) => mockCategoriesA.forEach((cat) => cb({ id: cat.categoryId, data: () => cat })) });
      } else if (subcol === 'items') {
        onNext({ forEach: (cb: any) => mockItemsA.forEach((itm) => cb({ id: itm.itemId, data: () => itm })) });
      } else {
        onNext({ forEach: () => {} });
      }
      return () => {};
    });

    const { rerender } = render(<CustomerRestaurantMenuPage key={mockProfileA.restaurantId} initialProfile={mockProfileA} />);
    expect(await screen.findByText('Butter Masala Dosa')).toBeInTheDocument();
    expect(screen.queryByText('Paneer Tikka Charcoal')).toBeNull();

    // Rerender for Restaurant B
    (onSnapshot as any).mockImplementation((q: any, onNext: any) => {
      const subcol = q?._subcol || '';
      if (subcol === 'categories') {
        onNext({ forEach: (cb: any) => mockCategoriesB.forEach((cat) => cb({ id: cat.categoryId, data: () => cat })) });
      } else if (subcol === 'items') {
        onNext({ forEach: (cb: any) => mockItemsB.forEach((itm) => cb({ id: itm.itemId, data: () => itm })) });
      } else {
        onNext({ forEach: () => {} });
      }
      return () => {};
    });

    (getDocs as any).mockImplementation(async (q: any) => {
      const subcol = q?._subcol || '';
      if (subcol === 'categories') {
        return { forEach: (cb: any) => mockCategoriesB.forEach((cat) => cb({ id: cat.categoryId, data: () => cat })) };
      }
      if (subcol === 'items') {
        return { forEach: (cb: any) => mockItemsB.forEach((itm) => cb({ id: itm.itemId, data: () => itm })) };
      }
      return { forEach: () => {} };
    });

    rerender(<CustomerRestaurantMenuPage key={mockProfileB.restaurantId} initialProfile={mockProfileB} />);
    expect(await screen.findByText('Paneer Tikka Charcoal')).toBeInTheDocument();
    expect(screen.queryByText('Butter Masala Dosa')).toBeNull();
  });

  it('9. Empty menu shows correct empty state ("No Menu Items Available")', async () => {
    (onSnapshot as any).mockImplementation((_q: any, onNext: any) => {
      onNext({ forEach: () => {} });
      return () => {};
    });
    (getDocs as any).mockImplementation(async () => ({ forEach: () => {} }));

    render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

    expect(await screen.findByText(/No Menu Items Available/i)).toBeInTheDocument();
    expect(screen.queryByText(/M9-F/i)).toBeNull();
  });

  it('10. Firebase/network error shows retry/error state ("Unable to load menu")', async () => {
    (getDocs as any).mockImplementation(async () => {
      throw new Error('Firebase connection lost');
    });

    render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

    expect(await screen.findByText(/Unable to Load Menu/i)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('11. Menu item can be added to cart', async () => {
    const { container } = render(
      <CustomerCartProvider>
        <CustomerRestaurantMenuPage initialProfile={mockProfileA} />
      </CustomerCartProvider>
    );

    expect(await screen.findByText('Butter Masala Dosa')).toBeInTheDocument();
    const addBtn = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addBtn);

    // Cart counter in header is updated
    await waitFor(() => {
      const countEl = container.querySelector('#menu-header-cart-count');
      expect(countEl?.textContent).toBe('1');
    });
  });

  it('16. No stale M9-F feature gate remains in active customer menu flow', async () => {
    render(<CustomerRestaurantPage initialProfile={mockProfileA} />);

    fireEvent.click(screen.getByText('View Menu'));

    expect(screen.queryByText(/Public menu browsing and customer food ordering will be activated in the upcoming Milestone/i)).toBeNull();
    expect(screen.queryByText(/Close Preview/i)).toBeNull();
  });
});
