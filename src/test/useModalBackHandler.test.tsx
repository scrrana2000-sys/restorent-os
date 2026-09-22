import React, { useState, useCallback } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useModalBackHandler } from '../hooks/useModalBackHandler';

// Dummy multi-step modal component for testing back button transitions
const MultiStepModalTestComponent: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const handleBack = useCallback(() => {
    if (step === 2) {
      setStep(1);
    } else {
      setIsOpen(false);
    }
  }, [step]);

  useModalBackHandler(isOpen, handleBack, 'test-order-modal');

  return (
    <div>
      <button data-testid="open-modal" onClick={() => { setIsOpen(true); setStep(1); }}>
        Open Order Modal
      </button>

      {isOpen && (
        <div data-testid="modal-content">
          <span>Current Step: {step}</span>
          {step === 1 && (
            <button data-testid="go-to-step-2" onClick={() => setStep(2)}>
              Next → Review Order
            </button>
          )}
          {step === 2 && (
            <button data-testid="go-to-step-1" onClick={() => setStep(1)}>
              Back to Menu
            </button>
          )}
          <button data-testid="close-modal" onClick={() => setIsOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
};

describe('useModalBackHandler Global Coordinated Stack', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not navigate when switching directly between two modal states', () => {
    const SwitchTestComponent: React.FC = () => {
      const [firstOpen, setFirstOpen] = useState(false);
      const [secondOpen, setSecondOpen] = useState(false);

      useModalBackHandler(firstOpen, () => setFirstOpen(false), 'switch-first');
      useModalBackHandler(secondOpen, () => setSecondOpen(false), 'switch-second');

      return (
        <div>
          <button data-testid="open-first" onClick={() => setFirstOpen(true)}>Open First</button>
          <button data-testid="switch-second" onClick={() => {
            setFirstOpen(false);
            setSecondOpen(true);
          }}>Switch Second</button>
          {firstOpen && <span>First</span>}
          {secondOpen && <span>Second</span>}
        </div>
      );
    };

    render(<SwitchTestComponent />);
    fireEvent.click(screen.getByTestId('open-first'));
    fireEvent.click(screen.getByTestId('switch-second'));
    expect(screen.getByText('Second')).toBeDefined();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.queryByText('Second')).toBeNull();
    expect(screen.queryByText('First')).toBeNull();
  });

  it('handles modal opening, step navigation, and back navigation deterministically', () => {
    render(<MultiStepModalTestComponent />);

    // Open Modal
    fireEvent.click(screen.getByTestId('open-modal'));
    expect(screen.getByTestId('modal-content')).toBeDefined();
    expect(screen.getByText('Current Step: 1')).toBeDefined();

    // Advance to Step 2
    fireEvent.click(screen.getByTestId('go-to-step-2'));
    expect(screen.getByText('Current Step: 2')).toBeDefined();

    // Simulate browser/Android back button event (popstate)
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Should transition back to Step 1, NOT close the modal
    expect(screen.getByTestId('modal-content')).toBeDefined();
    expect(screen.getByText('Current Step: 1')).toBeDefined();

    // Second back button press closes the modal
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.queryByTestId('modal-content')).toBeNull();
  });
});
