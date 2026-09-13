import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { parseVoiceTranscript } from '../services/voice/voiceParser';
import { matchItemAgainstMenu, matchVoiceTranscriptToMenu } from '../services/voice/voiceMenuMatcher';
import { MenuItem } from '../types/menu';
import { VoiceOrderButton } from '../components/voice/VoiceOrderButton';
import { VoiceOrderModal } from '../components/voice/VoiceOrderModal';
import { VoiceTranscript } from '../components/voice/VoiceTranscript';
import { VoiceMatchPreview } from '../components/voice/VoiceMatchPreview';

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
  },
  {
    itemId: 'item_4',
    restaurantId: 'rest_test',
    categoryId: 'cat_3',
    name: 'Butter Naan',
    shortName: 'Butter Naan',
    description: 'Soft tandoori naan brushed with butter',
    imageUrl: null,
    price: 45,
    taxRate: 5,
    taxInclusive: false,
    foodType: 'veg',
    isAvailable: true,
    sku: 'SKU-BN',
    sortOrder: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

describe('Voice Ordering - Voice Parser Unit Tests', () => {
  it('parses English transcript with multiple items and quantities', () => {
    const result = parseVoiceTranscript('2 veg biryani and 1 coke');
    expect(result.overallAction).toBe('ADD_ITEM');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      rawQuery: '2 veg biryani',
      cleanedName: 'veg biryani',
      quantity: 2,
      action: 'ADD_ITEM'
    });
    expect(result.items[1]).toEqual({
      rawQuery: '1 coke',
      cleanedName: 'coke',
      quantity: 1,
      action: 'ADD_ITEM'
    });
  });

  it('parses Hinglish number words (e.g. "do", "ek", "tin")', () => {
    const result = parseVoiceTranscript('do butter naan aur ek coke');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[0].cleanedName).toBe('butter naan');
    expect(result.items[1].quantity).toBe(1);
    expect(result.items[1].cleanedName).toBe('coke');
  });

  it('detects clear cart intent', () => {
    const result = parseVoiceTranscript('sara order cancel karo clear cart');
    expect(result.overallAction).toBe('CLEAR_CART');
  });

  it('detects item removal intent', () => {
    const result = parseVoiceTranscript('remove 1 coke');
    expect(result.items[0].action).toBe('REMOVE_ITEM');
    expect(result.items[0].cleanedName).toBe('coke');
  });

  it('handles invalid quantities (0, negative, decimals) safely and flags them', () => {
    const resZero = parseVoiceTranscript('0 biryani');
    expect(resZero.items[0].quantity).toBe(0);

    const resNegative = parseVoiceTranscript('-1 biryani');
    expect(resNegative.items[0].quantity).toBe(-1);

    const resDecimal = parseVoiceTranscript('1.5 biryani');
    expect(resDecimal.items[0].quantity).toBe(1.5);

    const resWordZero = parseVoiceTranscript('zero biryani');
    expect(resWordZero.items[0].quantity).toBe(0);

    // Verify matcher rejects invalid quantities
    const matchZero = matchItemAgainstMenu(resZero.items[0], mockMenuItems);
    expect(matchZero.unmatched).toBeDefined();

    const matchNegative = matchItemAgainstMenu(resNegative.items[0], mockMenuItems);
    expect(matchNegative.unmatched).toBeDefined();

    const matchDecimal = matchItemAgainstMenu(resDecimal.items[0], mockMenuItems);
    expect(matchDecimal.unmatched).toBeDefined();
  });

  it('parses multi-item sentences with noise/filler words cleanly', () => {
    const result = parseVoiceTranscript('2 veg biryani aur 1 coke bhaiya please jaldi lao');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].cleanedName).toBe('veg biryani');
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[1].cleanedName).toBe('coke');
    expect(result.items[1].quantity).toBe(1);
  });

  it('parses Hindi Devanagari script correctly', () => {
    const result = parseVoiceTranscript('दो वेज बिरयानी और एक कोक');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[0].cleanedName).toBe('वेज बिरयानी');
    expect(result.items[1].quantity).toBe(1);
    expect(result.items[1].cleanedName).toBe('कोक');

    const matchRes = matchVoiceTranscriptToMenu('दो वेज बिरयानी और एक कोक', mockMenuItems, 'hi-IN', true);
    expect(matchRes.matchedItems).toHaveLength(2);
    expect(matchRes.matchedItems[0].menuItem.name).toBe('Veg Biryani');
    expect(matchRes.matchedItems[1].menuItem.name).toBe('Coca Cola');
  });

  it('isolates partial parsing errors without corrupting valid matched items', () => {
    const matchRes = matchVoiceTranscriptToMenu('2 veg biryani aur 1 dragon pizza', mockMenuItems, 'auto', true);
    expect(matchRes.matchedItems).toHaveLength(1);
    expect(matchRes.matchedItems[0].menuItem.name).toBe('Veg Biryani');
    expect(matchRes.unmatchedItems).toHaveLength(1);
    expect(matchRes.unmatchedItems[0].rawQuery).toBe('1 dragon pizza');
  });
});

describe('Voice Ordering - Menu Matcher Unit Tests', () => {
  it('exact matches menu item', () => {
    const intent = {
      rawQuery: 'butter naan',
      cleanedName: 'butter naan',
      quantity: 2,
      action: 'ADD_ITEM' as const
    };
    const matchRes = matchItemAgainstMenu(intent, mockMenuItems);
    expect(matchRes.matched).toBeDefined();
    expect(matchRes.matched?.menuItem.itemId).toBe('item_4');
    expect(matchRes.matched?.quantity).toBe(2);
  });

  it('flags ambiguous queries with multiple candidate items (e.g. "biryani")', () => {
    const intent = {
      rawQuery: 'biryani',
      cleanedName: 'biryani',
      quantity: 1,
      action: 'ADD_ITEM' as const
    };
    const matchRes = matchItemAgainstMenu(intent, mockMenuItems);
    expect(matchRes.ambiguous).toBeDefined();
    expect(matchRes.ambiguous?.candidates).toHaveLength(2);
    expect(matchRes.ambiguous?.candidates.map((c) => c.name)).toContain('Veg Biryani');
    expect(matchRes.ambiguous?.candidates.map((c) => c.name)).toContain('Chicken Biryani');
  });

  it('handles unmatched items safely without throwing', () => {
    const intent = {
      rawQuery: 'pizza',
      cleanedName: 'pizza',
      quantity: 1,
      action: 'ADD_ITEM' as const
    };
    const matchRes = matchItemAgainstMenu(intent, mockMenuItems);
    expect(matchRes.unmatched).toBeDefined();
    expect(matchRes.unmatched?.rawQuery).toBe('pizza');
  });

  it('executes end-to-end speech transcript matching', () => {
    const parseRes = matchVoiceTranscriptToMenu(
      '2 veg biryani aur 1 coke',
      mockMenuItems,
      'auto',
      true
    );
    expect(parseRes.matchedItems).toHaveLength(2);
    expect(parseRes.requiresConfirmation).toBe(true);
    expect(parseRes.needsClarification).toBe(false);
  });
});

describe('Voice Ordering - UI Components Unit Tests', () => {
  it('renders VoiceOrderButton correctly', () => {
    const handleClick = vi.fn();
    render(<VoiceOrderButton onClick={handleClick} variant="header" />);
    const btn = screen.getByRole('button', { name: /voice order/i });
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders VoiceTranscript and state indicator', () => {
    render(
      <VoiceTranscript
        state="LISTENING"
        interimTranscript="2 biryani"
        finalTranscript=""
        selectedLanguage="auto"
        onLanguageChange={vi.fn()}
      />
    );
    expect(screen.getByText(/listening/i)).toBeDefined();
    expect(screen.getByText(/2 biryani/i)).toBeDefined();
  });

  it('renders VoiceMatchPreview and allows resolving ambiguous candidates', () => {
    const handleResolve = vi.fn();
    render(
      <VoiceMatchPreview
        matchedItems={[]}
        ambiguousItems={[
          {
            rawQuery: 'biryani',
            quantity: 1,
            candidates: [mockMenuItems[0], mockMenuItems[1]],
            action: 'ADD_ITEM'
          }
        ]}
        unmatchedItems={[]}
        overallAction="ADD_ITEM"
        currencySymbol="₹"
        onUpdateQuantity={vi.fn()}
        onRemoveMatchedItem={vi.fn()}
        onResolveAmbiguity={handleResolve}
        onSpeakAgain={vi.fn()}
      />
    );

    expect(screen.getByText(/Which one did you mean/i)).toBeDefined();
    const selectButtons = screen.getAllByText('Select');
    expect(selectButtons).toHaveLength(2);

    fireEvent.click(selectButtons[0]);
    expect(handleResolve).toHaveBeenCalledWith(0, mockMenuItems[0]);
  });

  it('renders VoiceOrderModal and enforces confirmation before adding to cart', async () => {
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

    expect(screen.getByText('RestaurantOS Voice Assistant')).toBeDefined();
    expect(screen.getByText(/Speak in Hindi or English/i)).toBeDefined();
  });
});
