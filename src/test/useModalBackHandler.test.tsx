import React, { useState, useCallback } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useModalBackHandler } from '../hooks/useModalBackHandler';

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
      <button
        type="button"
        data-testid="open-modal"
        onClick={() => {
          setIsOpen(true);
          setStep(1);
        }}
      >
        Open Order Modal
      </button>

      {isOpen && (
        <div data-testid="modal-content">
          <span>Current Step: {step}</span>
          {step === 1 && (
            <button type="button" data-testid="go-to-step-2" onClick={() => setStep(2)}>
              Next → Review Order
            </button>
          )}
          {step === 2 && (
            <button type="button" data-testid="go-to-step-1" onClick={() => setStep(1)}>
              Back to Menu
            </button>
          )}
          <button type="button" data-testid="close-modal" onClick={() => setIsOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
};

const SwitchingModalTestComponent: React.FC = () => {
  const [firstOpen, setFirstOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);

  useModalBackHandler(firstOpen, () => setFirstOpen(false), 'switch-first');
  useModalBackHandler(secondOpen, () => setSecondOpen(false), 'switch-second');

  return (
    <div>
      <button type="button" data-testid="open-first" onClick={() => setFirstOpen(true)}>
        Open First
      </button>
      <button
        type="button"
        data-testid="switch-second"
        onClick={() => {
          setFirstOpen(false);
          setSecondOpen(true);
        }}
      >
        Switch Second
      </button>

      {firstOpen && <span>First</span>}
      {secondOpen && <span>Second</span>}
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

  it('handles modal opening, step navigation, and back navigation deterministically', () => {
    render(<MultiStepModalTestComponent />);

    fireEvent.click(screen.getByTestId('open-modal'));
    expect(screen.getByTestId('modal-content')).toBeDefined();
    expect(screen.getByText('Current Step: 1')).toBeDefined();

    fireEvent.click(screen.getByTestId('go-to-step-2'));
    expect(screen.getByText('Current Step: 2')).toBeDefined();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByTestId('modal-content')).toBeDefined();
    expect(screen.getByText('Current Step: 1')).toBeDefined();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.queryByTestId('modal-content')).toBeNull();
  });

  it('does not navigate when switching directly between modal states', () => {
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const historyPush = vi.spyOn(window.history, 'pushState');
    const historyReplace = vi.spyOn(window.history, 'replaceState');

    render(<SwitchingModalTestComponent />);

    fireEvent.click(screen.getByTestId('open-first'));
    fireEvent.click(screen.getByTestId('switch-second'));

    expect(screen.queryByText('First')).toBeNull();
    expect(screen.getByText('Second')).toBeDefined();
    expect(historyBack).not.toHaveBeenCalled();

    const replaceCallsAfterSwitch = historyReplace.mock.calls.length;

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.queryByText('Second')).toBeNull();
    expect(historyBack).not.toHaveBeenCalled();
    expect(historyPush).toHaveBeenCalled();

    // The popstate handler restores the shared modal entry synchronously,
    // then React runs the closing effect and clears that temporary marker.
    // Neither operation traverses browser history.
    expect(historyReplace.mock.calls.length).toBe(replaceCallsAfterSwitch + 1);
  });

  it('closes a modal without traversing browser history', () => {
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const historyReplace = vi.spyOn(window.history, 'replaceState');

    render(<MultiStepModalTestComponent />);

    fireEvent.click(screen.getByTestId('open-modal'));
    fireEvent.click(screen.getByTestId('close-modal'));

    expect(historyBack).not.toHaveBeenCalled();
    expect(historyReplace).toHaveBeenCalled();
    expect(screen.queryByTestId('modal-content')).toBeNull();
  });
});
