import { useEffect, useRef, useCallback } from 'react';

interface ModalEntry {
  modalId: string;
  onClose: () => void;
}

const modalStack: ModalEntry[] = [];
let isListenerAttached = false;
let historyEntryActive = false;
let pendingHistoryRemoval = false;
let suppressNextPop = false;

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

function scheduleSharedModalHistoryRemoval() {
  if (typeof window === 'undefined' || !historyEntryActive || pendingHistoryRemoval) return;

  pendingHistoryRemoval = true;
  queueMicrotask(() => {
    pendingHistoryRemoval = false;

    // A second modal can replace the first one in the same React commit.
    // In that case the existing shared history entry is reused and must not
    // be consumed underneath the newly opened modal.
    if (modalStack.length > 0 || !historyEntryActive) return;

    suppressNextPop = true;
    try {
      window.history.back();
    } catch (e) {
      suppressNextPop = false;
      console.warn('[useModalBackHandler] history cleanup failed:', e);
    }
  });
}

function registerModal(modalId: string, onClose: () => void) {
  const existing = modalStack.find((entry) => entry.modalId === modalId);
  if (existing) {
    existing.onClose = onClose;
    pendingHistoryRemoval = false;
    return;
  }

  modalStack.push({ modalId, onClose });
  pendingHistoryRemoval = false;
  pushSharedModalHistoryEntry();
}

function unregisterModal(modalId: string) {
  const index = modalStack.findIndex((entry) => entry.modalId === modalId);
  if (index === -1) return;

  modalStack.splice(index, 1);

  // Keep the one shared browser history entry while another modal is open.
  // Only remove it after the entire modal stack becomes empty.
  if (modalStack.length === 0) {
    scheduleSharedModalHistoryRemoval();
  }
}

function ensureGlobalListener() {
  if (isListenerAttached || typeof window === 'undefined') return;
  isListenerAttached = true;

  window.addEventListener('popstate', () => {
    if (suppressNextPop) {
      suppressNextPop = false;
      historyEntryActive = false;
      return;
    }

    if (modalStack.length === 0) return;

    // The browser/Android Back gesture has already consumed the shared
    // modal entry. Invoke the top modal's back handler. If the modal stays
    // open (for example a nested step changed), restore the same single
    // entry. If it closes, its React effect cleanup removes the registration.
    historyEntryActive = false;

    const topModal = modalStack[modalStack.length - 1];
    try {
      topModal?.onClose();
    } catch (e) {
      console.warn('[useModalBackHandler] error in onClose during popstate:', e);
    }

    // React state cleanup happens after the event. Recreate the shared entry
    // now when there is still any registered modal. If the top modal closes,
    // cleanup will later remove it while retaining the entry for lower modals.
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

    unregisterModal(modalId);
    return () => {};
  }, [isOpen, modalId]);

  const handleManualClose = useCallback(() => {
    unregisterModal(modalId);
    onCloseRef.current();
  }, [modalId]);

  return { handleManualClose };
}
