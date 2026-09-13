import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  isVoiceRecognitionSupported
} from '../services/voice/voiceSupport';
import { VoiceOrderModal } from '../components/voice/VoiceOrderModal';
import { MenuItem } from '../types/menu';

const mockMenuItems: MenuItem[] = [
  {
    itemId: 'item_1',
    restaurantId: 'rest_test',
    categoryId: 'cat_1',
    name: 'Veg Biryani',
    shortName: 'Veg Biryani',
    description: 'Spiced veg biryani',
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
  }
];

describe('Voice Microphone Permission UX Tests', () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. handles permission granted state cleanly', async () => {
    const queryMock = vi.fn().mockResolvedValue({ state: 'granted', onchange: null });
    Object.defineProperty(global, 'navigator', {
      value: {
        permissions: { query: queryMock },
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [{ stop: vi.fn() }]
          })
        }
      },
      writable: true,
      configurable: true
    });

    const state = await checkMicrophonePermission();
    expect(state).toBe('granted');

    const reqRes = await requestMicrophonePermission();
    expect(reqRes.granted).toBe(true);
    expect(reqRes.state).toBe('granted');
  });

  it('2. handles permission prompt state without showing error prematurely', async () => {
    const queryMock = vi.fn().mockResolvedValue({ state: 'prompt', onchange: null });
    Object.defineProperty(global, 'navigator', {
      value: {
        permissions: { query: queryMock },
        mediaDevices: { getUserMedia: vi.fn() }
      },
      writable: true,
      configurable: true
    });

    const state = await checkMicrophonePermission();
    expect(state).toBe('prompt');

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={vi.fn()}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    // Prompt state should show Start Speaking button without "blocked" alert
    expect(screen.queryByText('Microphone access is blocked')).toBeNull();
    expect(screen.getByRole('button', { name: /start speaking/i })).toBeDefined();
  });

  it('3. handles permission denied state and displays clear alert', async () => {
    const queryMock = vi.fn().mockResolvedValue({ state: 'denied', onchange: null });
    Object.defineProperty(global, 'navigator', {
      value: {
        permissions: { query: queryMock },
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError'))
        }
      },
      writable: true,
      configurable: true
    });

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={vi.fn()}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Microphone access is blocked')).toBeDefined();
      expect(
        screen.getByText('Allow microphone access in your browser/site settings to use Voice Ordering.')
      ).toBeDefined();
    });
  });

  it('4. handles Permissions API unavailable gracefully', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { mediaDevices: undefined },
      writable: true,
      configurable: true
    });

    const state = await checkMicrophonePermission();
    expect(state).toBe('unknown');

    const reqRes = await requestMicrophonePermission();
    expect(reqRes.granted).toBe(false);
  });

  it('5. detects SpeechRecognition unsupported environment', () => {
    // In node/vitest window.SpeechRecognition is undefined by default
    expect(isVoiceRecognitionSupported()).toBe(false);

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={vi.fn()}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    expect(screen.getByText('Browser Speech Recognition Unavailable')).toBeDefined();
  });

  it('6. triggers Allow Microphone action flow correctly', async () => {
    const getUserMediaMock = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }]
    });

    Object.defineProperty(global, 'navigator', {
      value: {
        permissions: { query: vi.fn().mockResolvedValue({ state: 'denied', onchange: null }) },
        mediaDevices: { getUserMedia: getUserMediaMock }
      },
      writable: true,
      configurable: true
    });

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={vi.fn()}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Microphone access is blocked')).toBeDefined();
    });

    const allowBtn = screen.getByRole('button', { name: /allow microphone/i });
    fireEvent.click(allowBtn);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    });
  });

  it('7. handles Try Again action cleanly when still denied', async () => {
    const getUserMediaMock = vi.fn().mockRejectedValue({ name: 'NotAllowedError' });
    Object.defineProperty(global, 'navigator', {
      value: {
        permissions: { query: vi.fn().mockResolvedValue({ state: 'denied', onchange: null }) },
        mediaDevices: { getUserMedia: getUserMediaMock }
      },
      writable: true,
      configurable: true
    });

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={vi.fn()}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Microphone access is blocked')).toBeDefined();
    });

    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgainBtn);

    await waitFor(() => {
      // Should re-check without throwing or breaking UI
      expect(screen.getByText('Microphone access is blocked')).toBeDefined();
    });
  });

  it('8. handles Use Menu Instead fallback button', async () => {
    const handleClose = vi.fn();
    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={handleClose}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    const useMenuBtns = screen.getAllByRole('button', { name: /use menu instead/i });
    expect(useMenuBtns.length).toBeGreaterThan(0);

    fireEvent.click(useMenuBtns[0]);
    expect(handleClose).toHaveBeenCalled();
  });

  it('9. handles permission state change from denied to granted automatically', async () => {
    let changeListener: (() => void) | null = null;
    let currentState = 'denied';

    const queryMock = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        get state() {
          return currentState;
        },
        set onchange(fn: () => void) {
          changeListener = fn;
        }
      });
    });

    Object.defineProperty(global, 'navigator', {
      value: {
        permissions: { query: queryMock }
      },
      writable: true,
      configurable: true
    });

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={vi.fn()}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Microphone access is blocked')).toBeDefined();
    });

    // Simulate browser site setting change to granted
    currentState = 'granted';
    if (changeListener) {
      (changeListener as () => void)();
    }

    await waitFor(() => {
      expect(screen.queryByText('Microphone access is blocked')).toBeNull();
    });
  });

  it('10. prevents infinite permission retry loops on multiple taps', async () => {
    const getUserMediaMock = vi.fn().mockRejectedValue({ name: 'NotAllowedError' });
    Object.defineProperty(global, 'navigator', {
      value: {
        permissions: { query: vi.fn().mockResolvedValue({ state: 'denied', onchange: null }) },
        mediaDevices: { getUserMedia: getUserMediaMock }
      },
      writable: true,
      configurable: true
    });

    render(
      <VoiceOrderModal
        isOpen={true}
        onClose={vi.fn()}
        menuItems={mockMenuItems}
        restaurantId="rest_test"
        onAddToCart={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Microphone access is blocked')).toBeDefined();
    });

    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgainBtn);
    fireEvent.click(tryAgainBtn);
    fireEvent.click(tryAgainBtn);

    // Call count should be controlled and not explode infinitely
    await waitFor(() => {
      expect(getUserMediaMock.mock.calls.length).toBeLessThanOrEqual(3);
    });
  });
});
