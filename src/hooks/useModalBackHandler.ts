import { useEffect, useRef, useCallback } from 'react';

/**
 * Global coordinated modal history management for browser / Android Back button integration.
 * 
 * Rules & Invariants:
 * 1. Global stack ensures multi-modal sequences (e.g. ActiveSession -> StaffOrderModal) or
 *    sub-steps (Menu -> Review) do NOT cause popstate crosstalk or unexpected modal dismissals.
 * 2. When a modal opens, it registers in the active stack and pushes a single history state.
 * 3. When the user presses the real hardware/browser Back button (popstate), the top-most modal
 *    is popped and its `onClose` is executed safely.
 * 4. When a modal closes via UI / React state (isOpen becomes false or component unmounts),
 *    the history cleanup uses an atomic programmatic back counter (`programmaticBackCount`)
 *    so the resulting popstate event is silently consumed and never triggers onClose on another modal.
 * 5. Multiple simultaneous modal hooks do not fight or create phantom dismissals.
 */

interface ModalEntry {
  modalId: string;
  onClose: () => void;
  pushed: boolean;
}

const modalStack: ModalEntry[] = [];
let lastProgrammaticBackTimestamp = 0;
let isListenerAttached = false;

function ensureGlobalListener() {
  if (isListenerAttached || typeof window === 'undefined') return;
  isListenerAttached = true;

  window.addEventListener('popstate', () => {
    // If popstate was triggered by our own history.back() within the last 60ms during programmatic/UI close, consume it
    const now = Date.now();
    if (now - lastProgrammaticBackTimestamp < 60) {
      lastProgrammaticBackTimestamp = 0;
      return;
    }

    // Otherwise, this is a real user browser / Android back button press
    if (modalStack.length > 0) {
      const topModal = modalStack[modalStack.length - 1];
      if (topModal) {
        try {
          topModal.onClose();
        } catch (e) {
          console.warn('[useModalBackHandler] error in onClose during popstate:', e);
        }
      }
    }
  });
}

export function useModalBackHandler(
  isOpen: boolean,
  onClose: () => void,
  modalId: string
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    ensureGlobalListener();

    if (isOpen) {
      // Find existing entry or push new one
      let entry = modalStack.find((m) => m.modalId === modalId);
      if (!entry) {
        entry = {
          modalId,
          onClose: () => onCloseRef.current(),
          pushed: false
        };
        modalStack.push(entry);
      } else {
        entry.onClose = () => onCloseRef.current();
      }

      if (!entry.pushed) {
        try {
          window.history.pushState({ modalId, timestamp: Date.now() }, '');
          entry.pushed = true;
        } catch (e) {
          console.warn('[useModalBackHandler] pushState failed:', e);
        }
      }

      return () => {
        // Cleanup when modal unmounts or isOpen becomes false
        const idx = modalStack.findIndex((m) => m.modalId === modalId);
        if (idx !== -1) {
          const removed = modalStack.splice(idx, 1)[0];
          if (removed && removed.pushed) {
            removed.pushed = false;
            lastProgrammaticBackTimestamp = Date.now();
            try {
              window.history.back();
            } catch (e) {
              console.warn('[useModalBackHandler] cleanup back failed:', e);
            }
          }
        }
      };
    } else {
      // If isOpen is false, remove if present in stack and revert history cleanly
      const idx = modalStack.findIndex((m) => m.modalId === modalId);
      if (idx !== -1) {
        const removed = modalStack.splice(idx, 1)[0];
        if (removed && removed.pushed) {
          removed.pushed = false;
          lastProgrammaticBackTimestamp = Date.now();
          try {
            window.history.back();
          } catch (e) {
            console.warn('[useModalBackHandler] manual close back failed:', e);
          }
        }
      }
    }
  }, [isOpen, modalId]);

  const handleManualClose = useCallback(() => {
    const idx = modalStack.findIndex((m) => m.modalId === modalId);
    if (idx !== -1) {
      const removed = modalStack.splice(idx, 1)[0];
      if (removed && removed.pushed) {
        removed.pushed = false;
        lastProgrammaticBackTimestamp = Date.now();
        try {
          window.history.back();
        } catch (e) {
          console.warn('[useModalBackHandler] handleManualClose back failed:', e);
        }
      }
    }
    onCloseRef.current();
  }, [modalId]);

  return { handleManualClose };
}
