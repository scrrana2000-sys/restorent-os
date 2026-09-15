import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomerRestaurantMenuPage } from '../pages/customer/CustomerRestaurantMenuPage';
import {
  organizePublicMenu,
  fetchPublicMenu,
  subscribeToPublicMenu
} from '../services/customerMenuService';
import { FoodTypeBadge } from '../components/customer/FoodTypeBadge';
import { CustomerItemCustomizerModal } from '../components/customer/CustomerItemCustomizerModal';
import { PublicRestaurantProfile, CustomerCartItem } from '../types/customer';
import { Category, MenuItem } from '../types/menu';

let mockCategoriesStore: Category[] = [];
let mockItemsStore: MenuItem[] = [];

// Mock firebase firestore
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
  publicSlug: 'spice-junction-raichur',
  publicRestaurantCode: 'R-SJ01',
  name: 'Spice Junction',
  legalName: 'Spice Junction Hospitality LLP',
  logoUrl: 'https://images.unsplash.com/logo-spice.jpg',
  coverImageUrl: 'https://images.unsplash.com/cover-spice.jpg',
  phone: '+91 98765 11111',
  address: 'MG Road, Opposite Clock Tower',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'Station Area',
  postalCode: '584101',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['North Indian', 'Tandoori', 'Biryani'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockProfileB: PublicRestaurantProfile = {
  restaurantId: 'rest-tenant-b',
  publicSlug: 'dosa-corner-raichur',
  publicRestaurantCode: 'R-DC02',
  name: 'Dosa Corner',
  logoUrl: null,
  coverImageUrl: null,
  phone: '+91 98765 22222',
  address: 'Bazaar Street',
  city: 'Raichur',
  state: 'Karnataka',
  area: 'Main Market',
  postalCode: '584101',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['South Indian', 'Breakfast'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockCategoriesA: Category[] = [
  {
    categoryId: 'cat-starters',
    restaurantId: 'rest-tenant-a',
    name: 'Starters & Appetizers',
    description: 'Crispy and savory delicacies',
    imageUrl: null,
    sortOrder: 1,
    isActive: true
  },
  {
    categoryId: 'cat-mains',
    restaurantId: 'rest-tenant-a',
    name: 'Main Course Curry',
    description: 'Rich authentic gravies and curries',
    imageUrl: null,
    sortOrder: 2,
    isActive: true
  },
  {
    categoryId: 'cat-inactive',
    restaurantId: 'rest-tenant-a',
    name: 'Archived Seasonal Items',
    description: 'Old seasonal menu',
    imageUrl: null,
    sortOrder: 99,
    isActive: false
  }
];

const mockItemsA: MenuItem[] = [
  {
    itemId: 'item-paneer-tikka',
    restaurantId: 'rest-tenant-a',
    categoryId: 'cat-starters',
    name: 'Paneer Tikka',
    shortName: 'Paneer Tikka',
    description: 'Charcoal grilled cottage cheese cubes with mint dip',
    imageUrl: 'https://images.unsplash.com/paneer-tikka.jpg',
    price: 240,
    taxRate: 5,
    taxInclusive: true,
    foodType: 'veg',
    isAvailable: true,
    sku: 'SKU-PT01',
    sortOrder: 1
  },
  {
    itemId: 'item-chicken-kebab',
    restaurantId: 'rest-tenant-a',
    categoryId: 'cat-starters',
    name: 'Chicken Seekh Kebab',
    shortName: 'Chicken Kebab',
    description: 'Spiced minced chicken skewers cooked in clay oven',
    imageUrl: null,
    price: 320,
    taxRate: 5,
    taxInclusive: true,
    foodType: 'nonVeg',
    isAvailable: true,
    sku: 'SKU-CK02',
    sortOrder: 2,
    variants: [
      { id: 'var-half', name: 'Half (4 pcs)', price: 180 },
      { id: 'var-full', name: 'Full (8 pcs)', price: 320 }
    ],
    addons: [
      { id: 'addon-extra-dip', name: 'Garlic Mayo Dip', price: 30 },
      { id: 'addon-extra-rumali', name: 'Rumali Roti', price: 25 }
    ]
  },
  {
    itemId: 'item-dal-makhani',
    restaurantId: 'rest-tenant-a',
    categoryId: 'cat-mains',
    name: 'Dal Makhani Royal',
    shortName: 'Dal Makhani',
    description: 'Slow-cooked black lentils in rich creamy butter',
    imageUrl: null,
    price: 220,
    taxRate: 5,
    taxInclusive: true,
    foodType: 'veg',
    isAvailable: true,
    sku: 'SKU-DM01',
    sortOrder: 1
  },
  {
    itemId: 'item-mutton-rogan',
    restaurantId: 'rest-tenant-a',
    categoryId: 'cat-mains',
    name: 'Mutton Rogan Josh',
    shortName: 'Mutton Rogan',
    description: 'Tender mutton cooked in Kashmiri spices',
    imageUrl: null,
    price: 450,
    taxRate: 5,
    taxInclusive: true,
    foodType: 'nonVeg',
    isAvailable: false, // SOLD OUT
    sku: 'SKU-MR01',
    sortOrder: 2
  },
  {
    itemId: 'item-orphan-cat',
    restaurantId: 'rest-tenant-a',
    categoryId: 'cat-inactive', // Inactive category
    name: 'Secret Inactive Dish',
    shortName: 'Secret Dish',
    description: 'Should not appear',
    imageUrl: null,
    price: 500,
    taxRate: 5,
    taxInclusive: true,
    foodType: 'veg',
    isAvailable: true,
    sku: 'SKU-HIDDEN',
    sortOrder: 1
  }
];

const resetFirestoreMock = () => {
  (getDocs as any).mockImplementation((ref: any) => {
    const isCat = ref?._subcol === 'categories';
    const list = isCat ? mockCategoriesStore : mockItemsStore;
    return Promise.resolve({
      empty: list.length === 0,
      forEach: (cb: any) => list.forEach((entry: any) => cb({ id: entry.categoryId || entry.itemId, data: () => ({ ...entry }) })),
      docs: list.map((entry: any) => ({ id: entry.categoryId || entry.itemId, data: () => ({ ...entry }) }))
    });
  });

  (onSnapshot as any).mockImplementation((ref: any, callback: any) => {
    const isCat = ref?._subcol === 'categories';
    const list = isCat ? mockCategoriesStore : mockItemsStore;
    callback({
      empty: list.length === 0,
      forEach: (cb: any) => list.forEach((entry: any) => cb({ id: entry.categoryId || entry.itemId, data: () => ({ ...entry }) })),
      docs: list.map((entry: any) => ({ id: entry.categoryId || entry.itemId, data: () => ({ ...entry }) }))
    });
    return () => {};
  });
};

describe('M9-F Customer Restaurant Public Menu Master Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockCategoriesStore = [...mockCategoriesA];
    mockItemsStore = [...mockItemsA];
    resetFirestoreMock();
  });

  // -------------------------------------------------------------
  // SECTION 1: Service Unit Tests & Data Organization
  // -------------------------------------------------------------
  describe('1. organizePublicMenu Service Invariants', () => {
    it('(1) organizes menu, filters out inactive categories and items attached to inactive categories', () => {
      const result = organizePublicMenu('rest-tenant-a', mockCategoriesA, mockItemsA);

      expect(result.restaurantId).toBe('rest-tenant-a');
      expect(result.categories.length).toBe(2);
      expect(result.categories.map((c) => c.categoryId)).toEqual(['cat-starters', 'cat-mains']);

      // Inactive item 'item-orphan-cat' must not be in allItems
      expect(result.allItems.some((i) => i.itemId === 'item-orphan-cat')).toBe(false);
      expect(result.totalActiveItems).toBe(4);
    });

    it('(2) preserves category and item sortOrder', () => {
      const result = organizePublicMenu('rest-tenant-a', mockCategoriesA, mockItemsA);
      expect(result.categories[0].name).toBe('Starters & Appetizers');
      expect(result.categories[1].name).toBe('Main Course Curry');

      const starterItems = result.itemsByCategory['cat-starters'];
      expect(starterItems[0].name).toBe('Paneer Tikka');
      expect(starterItems[1].name).toBe('Chicken Seekh Kebab');
    });

    it('(3) handles empty categories or empty items gracefully', () => {
      const result = organizePublicMenu('rest-empty', [], []);
      expect(result.categories).toEqual([]);
      expect(result.allItems).toEqual([]);
      expect(result.totalActiveItems).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // SECTION 2: FoodTypeBadge & Customizer Modal
  // -------------------------------------------------------------
  describe('2. Sub-components (FoodTypeBadge & Customizer Modal)', () => {
    it('(4) FoodTypeBadge renders green for veg, red for nonveg, yellow for egg', () => {
      const { rerender } = render(<FoodTypeBadge foodType="veg" showLabel />);
      expect(screen.getByTestId('food-badge-veg')).toBeInTheDocument();
      expect(screen.getByText('Veg')).toBeInTheDocument();

      rerender(<FoodTypeBadge foodType="nonVeg" showLabel />);
      expect(screen.getByTestId('food-badge-nonveg')).toBeInTheDocument();
      expect(screen.getByText('Non-Veg')).toBeInTheDocument();

      rerender(<FoodTypeBadge foodType="egg" showLabel />);
      expect(screen.getByTestId('food-badge-egg')).toBeInTheDocument();
      expect(screen.getByText('Egg')).toBeInTheDocument();
    });

    it('(5) Customizer modal renders variants, updates price dynamically upon variant selection', () => {
      const handleAddToCart = vi.fn();
      const handleClose = vi.fn();
      const customItem = mockItemsA.find((i) => i.itemId === 'item-chicken-kebab')!;

      render(
        <CustomerItemCustomizerModal
          item={customItem}
          restaurant={mockProfileA}
          isOpen={true}
          onClose={handleClose}
          onAddToCart={handleAddToCart}
        />
      );

      expect(screen.getByText('Chicken Seekh Kebab')).toBeInTheDocument();
      expect(screen.getByText('Half (4 pcs)')).toBeInTheDocument();
      expect(screen.getByText('Full (8 pcs)')).toBeInTheDocument();

      // Default selected is Half (180)
      expect(screen.getAllByText('₹180').length).toBeGreaterThanOrEqual(1);

      // Click Full (320)
      fireEvent.click(screen.getByText('Full (8 pcs)'));
      expect(screen.getAllByText('₹320').length).toBeGreaterThanOrEqual(1);
    });

    it('(6) Customizer modal handles add-ons selection and adds prices accurately', () => {
      const handleAddToCart = vi.fn();
      const customItem = mockItemsA.find((i) => i.itemId === 'item-chicken-kebab')!;

      render(
        <CustomerItemCustomizerModal
          item={customItem}
          restaurant={mockProfileA}
          isOpen={true}
          onClose={() => {}}
          onAddToCart={handleAddToCart}
        />
      );

      // Select Half (180) + Garlic Mayo Dip (30) = 210
      fireEvent.click(screen.getByText('Garlic Mayo Dip'));
      expect(screen.getByText('₹210')).toBeInTheDocument();

      // Add Rumali Roti (25) = 235
      fireEvent.click(screen.getByText('Rumali Roti'));
      expect(screen.getByText('₹235')).toBeInTheDocument();
    });

    it('(7) Customizer modal quantity increment and special instructions work, submitting exact paise price', () => {
      const handleAddToCart = vi.fn();
      const handleClose = vi.fn();
      const customItem = mockItemsA.find((i) => i.itemId === 'item-chicken-kebab')!;

      render(
        <CustomerItemCustomizerModal
          item={customItem}
          restaurant={mockProfileA}
          isOpen={true}
          onClose={handleClose}
          onAddToCart={handleAddToCart}
        />
      );

      // Half (180) + Garlic Mayo Dip (30) = 210 * 2 = 420
      fireEvent.click(screen.getByText('Garlic Mayo Dip'));
      const plusBtn = document.getElementById('customizer-qty-plus')!;
      fireEvent.click(plusBtn);

      const notesInput = document.getElementById('customizer-item-notes')!;
      fireEvent.change(notesInput, { target: { value: 'Make it extra spicy' } });

      fireEvent.click(screen.getByText('Add Item'));

      expect(handleAddToCart).toHaveBeenCalledTimes(1);
      const payload: CustomerCartItem = handleAddToCart.mock.calls[0][0];
      expect(payload.itemId).toBe('item-chicken-kebab');
      expect(payload.name).toBe('Chicken Seekh Kebab');
      expect(payload.selectedVariantName).toBe('Half (4 pcs)');
      expect(payload.selectedAddons?.length).toBe(1);
      expect(payload.itemNotes).toBe('Make it extra spicy');
      expect(payload.price).toBe(21000); // 210 in paise
    });
  });

  // -------------------------------------------------------------
  // SECTION 3: Tenant Isolation & Public Menu Rendering
  // -------------------------------------------------------------
  describe('3. Strict Tenant Isolation & Menu Rendering', () => {
    it('(8) renders selected Restaurant A identity and active categories/items accurately', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getAllByText('Spice Junction').length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.getByText('R-SJ01')).toBeInTheDocument();
      expect(screen.getAllByText('Starters & Appetizers').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Main Course Curry').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      expect(screen.getByText('Dal Makhani Royal')).toBeInTheDocument();
    });

    it('(9) strictly isolates tenant: switching from Restaurant A to Restaurant B discards Restaurant A menu and displays Restaurant B menu', async () => {
      const mockCategoriesB: Category[] = [
        {
          categoryId: 'cat-dosa',
          restaurantId: 'rest-tenant-b',
          name: 'Special Dosas',
          description: 'Crispy butter dosas',
          imageUrl: null,
          sortOrder: 1,
          isActive: true
        }
      ];

      const mockItemsB: MenuItem[] = [
        {
          itemId: 'item-masala-dosa',
          restaurantId: 'rest-tenant-b',
          categoryId: 'cat-dosa',
          name: 'Mysore Masala Dosa',
          shortName: 'Masala Dosa',
          description: 'Spicy red chutney smeared crispy dosa',
          imageUrl: null,
          price: 110,
          taxRate: 5,
          taxInclusive: true,
          foodType: 'veg',
          isAvailable: true,
          sku: 'SKU-MD01',
          sortOrder: 1
        }
      ];

      const { rerender } = render(
        <CustomerRestaurantMenuPage initialProfile={mockProfileA} />
      );

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      // Switch to Restaurant B
      mockCategoriesStore = [...mockCategoriesB];
      mockItemsStore = [...mockItemsB];
      resetFirestoreMock();

      rerender(<CustomerRestaurantMenuPage initialProfile={mockProfileB} />);

      await waitFor(() => {
        expect(screen.getAllByText('Dosa Corner').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Mysore Masala Dosa')).toBeInTheDocument();
      });

      // Restaurant A's items must NEVER appear in Restaurant B's view
      expect(screen.queryByText('Paneer Tikka')).toBeNull();
      expect(screen.queryByText('Spice Junction')).toBeNull();
    });

    it('(10) inactive categories and their associated items are never rendered', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      expect(screen.queryByText('Archived Seasonal Items')).toBeNull();
      expect(screen.queryByText('Secret Inactive Dish')).toBeNull();
    });

    it('(11) out of stock items display "Sold Out" badge and disabled add action', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Mutton Rogan Josh')).toBeInTheDocument();
      });

      expect(screen.getAllByText('Sold Out').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Currently Unavailable')).toBeInTheDocument();
    });

    it('(12) items with variants or add-ons display "Customize" button', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Chicken Seekh Kebab')).toBeInTheDocument();
      });

      expect(screen.getByText('Customize')).toBeInTheDocument();
      expect(screen.getByText('Customizable options available')).toBeInTheDocument();
    });

    it('(13) clicking "Customize" opens customization modal', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Chicken Seekh Kebab')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Customize'));

      expect(screen.getByText('Choose Portion / Size')).toBeInTheDocument();
      expect(screen.getByText('Add-ons & Extras')).toBeInTheDocument();
    });

    it('(14) standard items without variants trigger direct onAddToCart with minor unit paise price', async () => {
      const handleAddToCart = vi.fn();

      render(
        <CustomerRestaurantMenuPage
          initialProfile={mockProfileA}
          onAddToCart={handleAddToCart}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      const addButtons = screen.getAllByText('Add');
      fireEvent.click(addButtons[0]);

      expect(handleAddToCart).toHaveBeenCalledTimes(1);
      const cartItem: CustomerCartItem = handleAddToCart.mock.calls[0][0];
      expect(cartItem.itemId).toBe('item-paneer-tikka');
      expect(cartItem.name).toBe('Paneer Tikka');
      expect(cartItem.price).toBe(24000); // ₹240 = 24000 paise
      expect(cartItem.quantity).toBe(1);
      expect(cartItem.isVeg).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // SECTION 4: Search & Dietary Filtering
  // -------------------------------------------------------------
  describe('4. Search & Dietary Filtering', () => {
    it('(15) search filters items in real time by dish name', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search for dishes/i);
      fireEvent.change(searchInput, { target: { value: 'Dal' } });

      expect(screen.getByText('Dal Makhani Royal')).toBeInTheDocument();
      expect(screen.queryByText('Paneer Tikka')).toBeNull();
      expect(screen.queryByText('Chicken Seekh Kebab')).toBeNull();
    });

    it('(16) search filters items by description', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search for dishes/i);
      fireEvent.change(searchInput, { target: { value: 'cottage cheese' } });

      expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      expect(screen.queryByText('Dal Makhani Royal')).toBeNull();
    });

    it('(17) "Veg Only" filter displays only vegetarian items', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Chicken Seekh Kebab')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Veg Only'));

      expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      expect(screen.getByText('Dal Makhani Royal')).toBeInTheDocument();
      expect(screen.queryByText('Chicken Seekh Kebab')).toBeNull();
      expect(screen.queryByText('Mutton Rogan Josh')).toBeNull();
    });

    it('(18) "Non-Veg" filter displays only non-vegetarian items', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Non-Veg'));

      expect(screen.getByText('Chicken Seekh Kebab')).toBeInTheDocument();
      expect(screen.getByText('Mutton Rogan Josh')).toBeInTheDocument();
      expect(screen.queryByText('Paneer Tikka')).toBeNull();
      expect(screen.queryByText('Dal Makhani Royal')).toBeNull();
    });

    it('(19) displays "No Matching Dishes Found" with working clear filters button when search returns 0 items', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search for dishes/i);
      fireEvent.change(searchInput, { target: { value: 'Sushi Rolls' } });

      expect(screen.getByText('No Matching Dishes Found')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Clear Filters'));
      expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------
  // SECTION 5: Category Navigation & Scroll
  // -------------------------------------------------------------
  describe('5. Category Navigation', () => {
    it('(20) renders category navigation pills with counts and handles category click', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getAllByText('Starters & Appetizers').length).toBeGreaterThanOrEqual(1);
      });

      const catNavPills = screen.getAllByRole('button').filter((b) => b.id.startsWith('cat-nav-'));
      expect(catNavPills.length).toBe(2);

      // Click second category
      fireEvent.click(catNavPills[1]);
      expect(catNavPills[1]).toHaveClass('bg-orange-600');
    });
  });

  // -------------------------------------------------------------
  // SECTION 6: Restaurant Operating Statuses
  // -------------------------------------------------------------
  describe('6. Operating Status Banners & Actions', () => {
    it('(21) displays paused banner and prevents order placement when restaurant is paused', async () => {
      const pausedProfile: PublicRestaurantProfile = {
        ...mockProfileA,
        publicStatus: 'paused',
        isOpenNow: false
      };

      render(<CustomerRestaurantMenuPage initialProfile={pausedProfile} />);

      await waitFor(() => {
        expect(screen.getByText('Ordering Currently Paused')).toBeInTheDocument();
      });

      expect(screen.getByText(/temporarily paused and not accepting new incoming orders/i)).toBeInTheDocument();
      expect(screen.getAllByText('View Only').length).toBeGreaterThanOrEqual(1);
    });

    it('(22) displays closed banner when restaurant is closed', async () => {
      const closedProfile: PublicRestaurantProfile = {
        ...mockProfileA,
        publicStatus: 'closed',
        isOpenNow: false
      };

      render(<CustomerRestaurantMenuPage initialProfile={closedProfile} />);

      await waitFor(() => {
        expect(screen.getByText('Restaurant Closed')).toBeInTheDocument();
      });

      expect(screen.getAllByText('View Only').length).toBeGreaterThanOrEqual(1);
    });

    it('(23) displays dine-in only notice when onlineOrderingEnabled is false', async () => {
      const dineInOnlyProfile: PublicRestaurantProfile = {
        ...mockProfileA,
        onlineOrderingEnabled: false,
        isOpenNow: false
      };

      render(<CustomerRestaurantMenuPage initialProfile={dineInOnlyProfile} />);

      await waitFor(() => {
        expect(screen.getByText('Dine-in & Walk-in Catalog Only')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------
  // SECTION 7: Empty, Error, Loading, and Navigation States
  // -------------------------------------------------------------
  describe('7. States & Navigation', () => {
    it('(24) shows loading skeleton during initial fetch', () => {
      (getDocs as any).mockImplementationOnce(() => new Promise(() => {}));

      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);
      expect(document.getElementById('menu-loading-skeleton')).toBeInTheDocument();
    });

    it('(25) shows not found state if restaurant does not exist', async () => {
      (getDocs as any).mockImplementation((_ref: any) => Promise.resolve({ empty: true, docs: [] }));

      render(<CustomerRestaurantMenuPage slug="non-existent-restaurant" />);

      await waitFor(() => {
        expect(screen.getByText('Restaurant Menu Not Found')).toBeInTheDocument();
      });
    });

    it('(26) shows error state with working retry button on failure', async () => {
      (getDocs as any).mockRejectedValueOnce(new Error('Network offline'));

      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Unable to Load Menu')).toBeInTheDocument();
      });

      // Retry succeeds because resetFirestoreMock will handle it
      resetFirestoreMock();

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });
    });

    it('(27) shows empty menu state when restaurant has 0 active items', async () => {
      mockCategoriesStore = [];
      mockItemsStore = [];
      resetFirestoreMock();

      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('No Menu Items Available')).toBeInTheDocument();
      });
      expect(screen.getByText(/This restaurant has not published any active menu items yet/i)).toBeInTheDocument();
    });

    it('(28) back button calls onBack callback', async () => {
      const handleBack = vi.fn();

      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} onBack={handleBack} />);

      await waitFor(() => {
        expect(screen.getAllByText('Spice Junction').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getByText('Back'));
      expect(handleBack).toHaveBeenCalledTimes(1);
    });

    it('(29) "Restaurant Info" button calls onViewProfile callback', async () => {
      const handleViewProfile = vi.fn();

      render(
        <CustomerRestaurantMenuPage
          initialProfile={mockProfileA}
          onViewProfile={handleViewProfile}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Restaurant Info')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Restaurant Info'));
      expect(handleViewProfile).toHaveBeenCalledWith(mockProfileA);
    });
  });

  // -------------------------------------------------------------
  // SECTION 8: Cart Boundary & Floating Summary
  // -------------------------------------------------------------
  describe('8. Customer Cart Boundary & Summary Bar', () => {
    it('(30) floating cart bar appears when items are added with item count and subtotal', async () => {
      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      expect(screen.queryByText(/items added/i)).toBeNull();

      // Add item
      const addBtns = screen.getAllByText('Add');
      fireEvent.click(addBtns[0]);

      expect(screen.getByText(/1 item added/i)).toBeInTheDocument();
      expect(screen.getByText(/Subtotal: ₹240.00/i)).toBeInTheDocument();
    });

    it('(31) clicking floating cart bar calls onViewCart or opens M9-G boundary notice modal', async () => {
      const handleViewCart = vi.fn();

      const { rerender } = render(
        <CustomerRestaurantMenuPage
          initialProfile={mockProfileA}
          cartItemCount={2}
          cartSubtotal={50000}
          onViewCart={handleViewCart}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('View Cart')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('View Cart'));
      expect(handleViewCart).toHaveBeenCalledTimes(1);

      // Without onViewCart prop, opens boundary notice
      rerender(
        <CustomerRestaurantMenuPage
          initialProfile={mockProfileA}
          cartItemCount={2}
          cartSubtotal={50000}
        />
      );

      fireEvent.click(screen.getByText('View Cart'));
      expect(screen.getByText(/Cart management, delivery address selection/i)).toBeInTheDocument();

      fireEvent.click(screen.getByText('Continue Browsing'));
      expect(screen.queryByText(/Cart management, delivery address selection/i)).toBeNull();
    });

    it('(32) strictly never leaks private tenant fields (no staffList, ownerId, secret keys, cost pricing)', async () => {
      const rawLeakedItem: any = {
        ...mockItemsA[0],
        costPricePaise: 9000,
        supplierId: 'SUPP_SECRET',
        recipeId: 'RECIPE_SECRET',
        ownerId: 'OWNER_SECRET'
      };

      mockCategoriesStore = [...mockCategoriesA];
      mockItemsStore = [rawLeakedItem];
      resetFirestoreMock();

      render(<CustomerRestaurantMenuPage initialProfile={mockProfileA} />);

      await waitFor(() => {
        expect(screen.getByText('Paneer Tikka')).toBeInTheDocument();
      });

      expect(screen.queryByText('SUPP_SECRET')).toBeNull();
      expect(screen.queryByText('RECIPE_SECRET')).toBeNull();
      expect(screen.queryByText('OWNER_SECRET')).toBeNull();
      expect(screen.queryByText('9000')).toBeNull();
    });
  });
});
