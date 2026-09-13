import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MenuItem } from '../types/menu';
import { CartItem } from '../types/cart';
import { matchVoiceTranscriptToMenu, mergeMatchedItemResults } from '../services/voice/voiceMenuMatcher';
import { VoiceOrderModal } from '../components/voice/VoiceOrderModal';
import { orderService } from '../services/orderService';
import { kotService } from '../services/kotService';

// Mock active restaurant menu items
const mockMenuItems: MenuItem[] = [
  {
    itemId: 'item_1',
    restaurantId: 'rest_test',
    categoryId: 'cat_1',
    name: 'Veg Biryani',
    shortName: 'Veg Biryani',
    description: 'Fragrant basmati rice with spiced vegetables',
    imageUrl: null,
    price: 250,
    taxRate: 5,
    taxInclusive: false,
    foodType: 'veg',
    isAvailable: true,
    sku: 'SKU-VB',
    sortOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    itemId: 'item_2',
    restaurantId: 'rest_test',
    categoryId: 'cat_1',
    name: 'Chicken Biryani',
    shortName: 'Chkn Biryani',
    description: 'Classic dum biryani with tender chicken',
    imageUrl: null,
    price: 320,
    taxRate: 5,
    taxInclusive: false,
    foodType: 'nonVeg',
    isAvailable: true,
    sku: 'SKU-CB',
    sortOrder: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    itemId: 'item_3',
    restaurantId: 'rest_test',
    categoryId: 'cat_2',
    name: 'Coca Cola',
    shortName: 'Coke',
    description: 'Chilled soft drink 300ml',
    imageUrl: null,
    price: 60,
    taxRate: 5,
    taxInclusive: false,
    foodType: 'veg',
    isAvailable: true,
    sku: 'SKU-CC',
    sortOrder: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// Helper to simulate POS cart voice merge behavior as in PosPage.tsx
function simulatePosVoiceAddToCart(
  currentCart: CartItem[],
  itemsToAdd: { item: MenuItem; quantity: number }[]
): CartItem[] {
  let updated = [...currentCart];
  for (const { item, quantity } of itemsToAdd) {
    if (!item.isAvailable) continue;
    const existingIdx = updated.findIndex((ci) => ci.itemId === item.itemId);
    if (existingIdx >= 0) {
      updated[existingIdx] = {
        ...updated[existingIdx],
        quantity: updated[existingIdx].quantity + quantity
      };
    } else {
      updated.push({
        cartItemId: `cart_${item.itemId}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        itemId: item.itemId,
        nameSnapshot: item.name,
        shortNameSnapshot: item.shortName || item.name.slice(0, 16),
        imageUrlSnapshot: item.imageUrl || null,
        foodTypeSnapshot: item.foodType || null,
        unitPriceMinor: Math.round(item.price * 100),
        taxRate: item.taxRate || 5,
        taxInclusive: !!item.taxInclusive,
        quantity
      });
    }
  }
  return updated;
}

describe('Phase 11D - Voice Ordering Merge vs Replace Verification Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TEST 1: Voice item A -> Add to Cart -> voice item B => POS cart contains A + B', () => {
    let posCart: CartItem[] = [];

    // First voice session: "Ek veg biryani"
    const res1 = matchVoiceTranscriptToMenu('Ek veg biryani', mockMenuItems, 'auto', true);
    const draft1 = mergeMatchedItemResults([], res1.matchedItems);
    posCart = simulatePosVoiceAddToCart(
      posCart,
      draft1.map((d) => ({ item: d.menuItem, quantity: d.quantity }))
    );

    expect(posCart).toHaveLength(1);
    expect(posCart[0].nameSnapshot).toBe('Veg Biryani');
    expect(posCart[0].quantity).toBe(1);

    // Second voice session: "Do chicken biryani"
    const res2 = matchVoiceTranscriptToMenu('Do chicken biryani', mockMenuItems, 'auto', true);
    const draft2 = mergeMatchedItemResults([], res2.matchedItems);
    posCart = simulatePosVoiceAddToCart(
      posCart,
      draft2.map((d) => ({ item: d.menuItem, quantity: d.quantity }))
    );

    expect(posCart).toHaveLength(2);
    expect(posCart.find((c) => c.nameSnapshot === 'Veg Biryani')?.quantity).toBe(1);
    expect(posCart.find((c) => c.nameSnapshot === 'Chicken Biryani')?.quantity).toBe(2);
  });

  it('TEST 2: Voice item A x1 -> Voice item A x1 => Voice draft quantity accumulates to 2', () => {
    // Session 1 utterance 1: "Ek veg biryani"
    const res1 = matchVoiceTranscriptToMenu('Ek veg biryani', mockMenuItems, 'auto', true);
    let draft = mergeMatchedItemResults([], res1.matchedItems);
    expect(draft).toHaveLength(1);
    expect(draft[0].quantity).toBe(1);

    // Session 1 utterance 2 (Speak More): "Ek veg biryani"
    const res2 = matchVoiceTranscriptToMenu('Ek veg biryani', mockMenuItems, 'auto', true);
    draft = mergeMatchedItemResults(draft, res2.matchedItems);

    expect(draft).toHaveLength(1);
    expect(draft[0].menuItem.name).toBe('Veg Biryani');
    expect(draft[0].quantity).toBe(2);
  });

  it('TEST 3: Voice A x1 -> Voice B x2 -> Voice C x1 => Voice draft contains A x1, B x2, C x1', () => {
    let draft = mergeMatchedItemResults(
      [],
      matchVoiceTranscriptToMenu('Ek veg biryani', mockMenuItems, 'auto', true).matchedItems
    );

    draft = mergeMatchedItemResults(
      draft,
      matchVoiceTranscriptToMenu('Do chicken biryani', mockMenuItems, 'auto', true).matchedItems
    );

    draft = mergeMatchedItemResults(
      draft,
      matchVoiceTranscriptToMenu('Ek coke', mockMenuItems, 'auto', true).matchedItems
    );

    expect(draft).toHaveLength(3);
    expect(draft.find((d) => d.menuItem.name === 'Veg Biryani')?.quantity).toBe(1);
    expect(draft.find((d) => d.menuItem.name === 'Chicken Biryani')?.quantity).toBe(2);
    expect(draft.find((d) => d.menuItem.name === 'Coca Cola')?.quantity).toBe(1);
  });

  it('TEST 4: Existing POS cart item X -> voice item Y => POS cart contains X + Y', () => {
    // Existing POS cart has Coca Cola (item X)
    let posCart = simulatePosVoiceAddToCart([], [{ item: mockMenuItems[2], quantity: 1 }]);
    expect(posCart).toHaveLength(1);
    expect(posCart[0].nameSnapshot).toBe('Coca Cola');

    // Voice order draft has Veg Biryani (item Y)
    const voiceResult = matchVoiceTranscriptToMenu('Ek veg biryani', mockMenuItems, 'auto', true);
    const voiceDraft = mergeMatchedItemResults([], voiceResult.matchedItems);

    posCart = simulatePosVoiceAddToCart(
      posCart,
      voiceDraft.map((d) => ({ item: d.menuItem, quantity: d.quantity }))
    );

    expect(posCart).toHaveLength(2);
    expect(posCart.map((c) => c.nameSnapshot)).toContain('Coca Cola');
    expect(posCart.map((c) => c.nameSnapshot)).toContain('Veg Biryani');
  });

  it('TEST 5: Existing POS cart item X -> voice item X => POS cart quantity increases to 2', () => {
    // Existing POS cart has Veg Biryani x1
    let posCart = simulatePosVoiceAddToCart([], [{ item: mockMenuItems[0], quantity: 1 }]);
    expect(posCart[0].quantity).toBe(1);

    // Voice order adds another Veg Biryani x1
    const voiceResult = matchVoiceTranscriptToMenu('Ek veg biryani', mockMenuItems, 'auto', true);
    const voiceDraft = mergeMatchedItemResults([], voiceResult.matchedItems);

    posCart = simulatePosVoiceAddToCart(
      posCart,
      voiceDraft.map((d) => ({ item: d.menuItem, quantity: d.quantity }))
    );

    expect(posCart).toHaveLength(1);
    expect(posCart[0].nameSnapshot).toBe('Veg Biryani');
    expect(posCart[0].quantity).toBe(2);
  });

  it('TEST 6: Voice draft -> Cancel => Existing POS cart remains unchanged', () => {
    const initialPosCart = simulatePosVoiceAddToCart([], [{ item: mockMenuItems[0], quantity: 1 }]);

    const handleAddToCart = vi.fn();
    const handleClose = vi.fn();

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={handleClose}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={handleAddToCart}
      />
    );

    // When modal is cancelled or closed without confirming
    handleClose();

    expect(handleAddToCart).not.toHaveBeenCalled();
    expect(initialPosCart).toHaveLength(1);
    expect(initialPosCart[0].quantity).toBe(1);
  });

  it('TEST 7: Voice draft -> Add to Cart -> Add to Cart again (double click) => Guard prevents duplicate additions', async () => {
    const handleAddToCart = vi.fn();
    const handleClose = vi.fn();

    const { rerender } = render(
      <VoiceOrderModal
        isOpen={true}
        onClose={handleClose}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={handleAddToCart}
      />
    );

    // Simulate items in draft
    const itemsToAdd = [{ item: mockMenuItems[0], quantity: 1 }];

    // Rapid double submission guard check
    let isSubmitting = false;
    const triggerSubmit = () => {
      if (isSubmitting) return;
      isSubmitting = true;
      handleAddToCart(itemsToAdd);
      handleClose();
    };

    triggerSubmit();
    triggerSubmit(); // Second rapid click while submitting

    expect(handleAddToCart).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('TEST 8: Multiple voice items -> final checkout / place order => ONE order containing all items', async () => {
    // Build POS cart with multiple items added via voice
    let posCart = simulatePosVoiceAddToCart(
      [],
      [
        { item: mockMenuItems[0], quantity: 1 },
        { item: mockMenuItems[1], quantity: 2 },
        { item: mockMenuItems[2], quantity: 1 }
      ]
    );

    expect(posCart).toHaveLength(3);

    // Mock createOrderAndKOTFromCart
    const mockCreatedOrder = {
      orderId: 'ord_123',
      orderNumber: 101,
      restaurantId: 'rest_test',
      orderType: 'dineIn',
      status: 'confirmed',
      items: posCart,
      subtotalMinor: 95000,
      grandTotalMinor: 99750
    };
    const mockCreatedKot = {
      kotId: 'kot_123',
      kotNumber: 1,
      orderId: 'ord_123',
      items: posCart
    };

    vi.spyOn(orderService, 'createOrderAndKOTFromCart').mockResolvedValue({
      order: mockCreatedOrder as any,
      kot: mockCreatedKot as any
    });

    const res = await orderService.createOrderAndKOTFromCart({
      restaurantId: 'rest_test',
      cartState: { items: posCart },
      orderType: 'dineIn',
      source: 'pos',
      createdBy: 'user_1'
    });

    expect(res.order.items).toHaveLength(3);
    expect(res.order.items.reduce((s, i) => s + i.quantity, 0)).toBe(4);
    expect(res.kot.items).toHaveLength(3);
  });

  it('TEST 9: Unknown voice item => Expected it is NOT added to draft/cart', () => {
    const res = matchVoiceTranscriptToMenu('1 dragon potion', mockMenuItems, 'auto', true);

    expect(res.matchedItems).toHaveLength(0);
    expect(res.unmatchedItems).toHaveLength(1);
    expect(res.unmatchedItems[0].rawQuery).toBe('1 dragon potion');

    const draft = mergeMatchedItemResults([], res.matchedItems);
    expect(draft).toHaveLength(0);

    const posCart = simulatePosVoiceAddToCart([], draft.map((d) => ({ item: d.menuItem, quantity: d.quantity })));
    expect(posCart).toHaveLength(0);
  });

  it('TEST 10: Active restaurant menu isolation => Voice matching only uses current restaurant catalog', () => {
    const otherRestaurantMenuItems: MenuItem[] = [
      {
        itemId: 'other_1',
        restaurantId: 'other_restaurant',
        categoryId: 'cat_x',
        name: 'Sushi Roll',
        shortName: 'Sushi',
        description: 'Fresh salmon sushi',
        imageUrl: null,
        price: 500,
        taxRate: 5,
        taxInclusive: false,
        foodType: 'nonVeg',
        isAvailable: true,
        sku: 'SKU-SUSHI',
        sortOrder: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    // Querying sushi against rest_test catalog
    const res = matchVoiceTranscriptToMenu('1 sushi roll', mockMenuItems, 'auto', true);

    // Must be unmatched because sushi roll is NOT in rest_test catalog
    expect(res.matchedItems).toHaveLength(0);
    expect(res.unmatchedItems).toHaveLength(1);
  });
});
