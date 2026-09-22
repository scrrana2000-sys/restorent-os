import { useEffect, useRef, useCallback } from 'react';

interface ModalEntry {
  modalId: string;
  onClose: () => void;
}

const modalStack: ModalEntry[] = [];
let isListenerAttached = false;
let historyEntryActive = false;

function pushSharedModalHistoryEntry() {
  if (typeof window === 'undefined' || historyEntryActive) return;

  try {
    window.history.pushState(
      { restaurantOSModal: true, timestamp: Date.now() },
      '',
      window.location.href
    );
    historyEntryActive = true;
  } catch (e) {
    console.warn('[useModalBackHandler] pushState failed:', e);
  }
}

/**
 * Clear our modal marker without traversing browser history.
 *
 * IMPORTANT: Never call history.back() for a normal React/UI modal close.
 * That turns a harmless state change into real browser navigation and can
 * make the AI Studio / Android-hosted app appear to reload.
 */
function clearSharedModalHistoryEntry() {
  if (typeof window === 'undefined' || !historyEntryActive) return;

  try {
    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? { ...window.history.state }
        : {};

    delete (currentState as Record<string, unknown>).restaurantOSModal;
    delete (currentState as Record<string, unknown>).timestamp;

    window.history.replaceState(
      currentState,
      '',
      window.location.href
    );
  } catch (e) {
    console.warn('[useModalBackHandler] replaceState cleanup failed:', e);
  } finally {
    historyEntryActive = false;
  }
}

function registerModal(modalId: string, onClose: () => void) {
  const existing = modalStack.find((entry) => entry.modalId === modalId);

  if (existing) {
    existing.onClose = onClose;
    return;
  }

  modalStack.push({ modalId, onClose });
  pushSharedModalHistoryEntry();
}

function unregisterModal(modalId: string) {
  const index = modalStack.findIndex((entry) => entry.modalId === modalId);
  if (index === -1) return;

  modalStack.splice(index, 1);

  // Keep the shared history entry while any modal remains open.
  // When the stack becomes empty, clear the marker in-place. DO NOT navigate.
  if (modalStack.length === 0) {
    clearSharedModalHistoryEntry();
  }
}

function ensureGlobalListener() {
  if (isListenerAttached || typeof window === 'undefined') return;

  isListenerAttached = true;

  window.addEventListener('popstate', () => {
    if (modalStack.length === 0) return;

    // A real browser/Android Back press has already consumed the modal
    // history entry. Handle it at the UI layer instead of navigating further.
    historyEntryActive = false;

    const topModal = modalStack[modalStack.length - 1];

    try {
      topModal?.onClose();
    } catch (e) {
      console.warn('[useModalBackHandler] error in onClose during popstate:', e);
    }

    // React state effects run after the event. If the modal remains open
    // (for example a nested step changed), restore exactly one modal entry.
    if (modalStack.length > 0) {
      pushSharedModalHistoryEntry();
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
      registerModal(modalId, () => onCloseRef.current());

      return () => {
        unregisterModal(modalId);
      };
    }

    // Remove any stale registration without touching browser history.
    unregisterModal(modalId);
    return () => {};
  }, [isOpen, modalId]);

  const handleManualClose = useCallback(() => {
    unregisterModal(modalId);
    onCloseRef.current();
  }, [modalId]);

  return { handleManualClose };
}
