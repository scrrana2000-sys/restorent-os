import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StaffOrderModal } from '../components/captain/StaffOrderModal';
import { Table, TableSession } from '../types/table';
import { MenuItem, Category } from '../types/menu';

// Mock RestaurantContext
const mockRestaurant = {
  restaurantId: 'REST_TEST_123',
  name: 'Test Kitchen',
  currencySymbol: '₹'
};

vi.mock('../context/RestaurantContext', () => ({
  useRestaurant: () => ({ restaurant: mockRestaurant })
}));

// Mock AuthContext
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user_captain_1', name: 'Captain Rahul' } })
}));

// Mock menuService
const mockCategories: Category[] = [
  { categoryId: 'cat_biryani', restaurantId: 'REST_TEST_123', name: 'Biryani', description: '', imageUrl: null, sortOrder: 1, isActive: true },
  { categoryId: 'cat_drinks', restaurantId: 'REST_TEST_123', name: 'Drinks', description: '', imageUrl: null, sortOrder: 2, isActive: true }
];

const mockMenuItems: MenuItem[] = [
  {
    itemId: 'item_biryani_1',
    restaurantId: 'REST_TEST_123',
    categoryId: 'cat_biryani',
    name: 'Hyderabadi Chicken Biryani',
    shortName: 'Hyd Biryani',
    description: 'Aromatic basmati rice with spiced chicken',
    imageUrl: 'https://images.unsplash.com/biryani.jpg',
    price: 320,
    taxRate: 5,
    taxInclusive: false,
    foodType: 'nonVeg',
    isAvailable: true,
    sku: 'BIR-01',
    sortOrder: 1
  },
  {
    itemId: 'item_coke_1',
    restaurantId: 'REST_TEST_123',
    categoryId: 'cat_drinks',
    name: 'Chilled Coke Can',
    shortName: 'Coke',
    description: '300ml cold can',
    imageUrl: null,
    price: 60,
    taxRate: 5,
    taxInclusive: false,
    foodType: 'veg',
    isAvailable: true,
    sku: 'DRK-01',
    sortOrder: 2
  }
];

vi.mock('../services/menuService', () => ({
  menuService: {
    subscribeToMenuItems: vi.fn((restaurantId, callback) => {
      callback(mockMenuItems);
      return vi.fn();
    }),
    subscribeToCategories: vi.fn((restaurantId, callback) => {
      callback(mockCategories);
      return vi.fn();
    })
  }
}));

// Mock orderService
const mockCreateOrderAndKOTFromCart = vi.fn().mockResolvedValue({
  order: { id: 'ord_123', orderNumber: '101', status: 'confirmed', totalMinor: 38000 },
  kot: { id: 'kot_123', kotNumber: 'KOT-001', status: 'sentToKitchen' }
});

vi.mock('../services/orderService', () => ({
  orderService: {
    createOrderAndKOTFromCart: (...args: any[]) => mockCreateOrderAndKOTFromCart(...args)
  }
}));

describe('Captain / Staff 2-Step Visual Ordering Flow', () => {
  const mockTable: Table = {
    id: 'tbl_5',
    restaurantId: 'REST_TEST_123',
    tableNumber: '5',
    name: 'Table 5',
    floorOrArea: 'Main Floor',
    capacity: 4,
    isActive: true,
    sortOrder: 5,
    activeSessionId: 'sess_5',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockSession: TableSession = {
    id: 'sess_5',
    restaurantId: 'REST_TEST_123',
    tableId: 'tbl_5',
    guestCount: 3,
    status: 'open',
    activeOrderIds: [],
    openedAt: new Date(),
    openedBy: 'user_captain_1',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Flow Test: Table → Add Biryani → Add Coke → Next → Review Order → Send to Kitchen (Single Order & Single KOT, No duplicates)', async () => {
    const handleClose = vi.fn();
    const handleOrderPlaced = vi.fn();

    render(
      <StaffOrderModal
        isOpen={true}
        table={mockTable}
        session={mockSession}
        onClose={handleClose}
        onOrderPlaced={handleOrderPlaced}
      />
    );

    // 1. Verify Step 1 Layout: Table header & category chips
    expect(screen.getByText(/Take Order — Table 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 1: Select Food/i)).toBeInTheDocument();
    expect(screen.getByText('Hyderabadi Chicken Biryani')).toBeInTheDocument();
    expect(screen.getByText('Chilled Coke Can')).toBeInTheDocument();

    // Do NOT show in Step 1: Send to Kitchen button or overall notes box
    expect(screen.queryByTestId('btn-confirm-send-kitchen')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Overall kitchen instructions/i)).not.toBeInTheDocument();

    // 2. Add Biryani to cart
    const addBiryaniBtn = screen.getByTestId('btn-add-item_biryani_1');
    fireEvent.click(addBiryaniBtn);

    // 3. Add Coke to cart
    const addCokeBtn = screen.getByTestId('btn-add-item_coke_1');
    fireEvent.click(addCokeBtn);

    // 4. Verify Floating Bar appears with correct count & next button
    const nextBtn = screen.getByTestId('btn-next-review-order');
    expect(nextBtn).toBeInTheDocument();
    expect(screen.getByText(/2 Items/i)).toBeInTheDocument();

    // 5. Click Next to go to Step 2
    fireEvent.click(nextBtn);

    // 6. Verify Step 2 Review Screen
    expect(screen.getByText(/Step 2: Review & Send KOT/i)).toBeInTheDocument();
    expect(screen.getByText(/Table 5 Order Slip/i)).toBeInTheDocument();
    expect(screen.getByTestId('btn-back-to-menu')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Overall kitchen instructions/i)).toBeInTheDocument();

    // 7. Verify back-to-menu retains cart items
    const backBtn = screen.getByTestId('btn-back-to-menu');
    fireEvent.click(backBtn);
    expect(screen.getByText(/Step 1: Select Food/i)).toBeInTheDocument();
    expect(screen.getByText(/2 Items/i)).toBeInTheDocument();

    // Return to Step 2
    const nextBtnAgain = screen.getByTestId('btn-next-review-order');
    fireEvent.click(nextBtnAgain);

    // 8. Send to Kitchen
    const sendKitchenBtn = screen.getByTestId('btn-confirm-send-kitchen');
    expect(sendKitchenBtn).toBeInTheDocument();
    fireEvent.click(sendKitchenBtn);

    // 9. Verify single KOT and single Order call with correct payload
    expect(mockCreateOrderAndKOTFromCart).toHaveBeenCalledTimes(1);
    expect(mockCreateOrderAndKOTFromCart).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'REST_TEST_123',
        tableId: 'tbl_5',
        tableSessionId: 'sess_5',
        orderType: 'dineIn',
        source: 'captain',
        cartState: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ itemId: 'item_biryani_1', quantity: 1 }),
            expect.objectContaining({ itemId: 'item_coke_1', quantity: 1 })
          ])
        })
      })
    );
  });
});
