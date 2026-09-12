import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to manage mobile/browser Back button integration for modals, drawers, and mobile tab states.
 * 
 * Rules:
 * 1. When `isOpen` becomes true, pushes a single deterministic history state entry.
 * 2. When user presses browser/Android Back button (popstate), calls `onClose` and resets state without further history changes.
 * 3. When modal is closed programmatically or via UI (X button, cancel, etc.), cleanly reverts the pushed history entry via `history.back()`
 *    without leaving stray history entries or creating loops.
 * 4. Ensures repeated open/close cycles do NOT corrupt browser history or create duplicate entries.
 */
export function useModalBackHandler(
  isOpen: boolean,
  onClose: () => void,
  modalId: string
) {
  const isPushedRef = useRef(false);
  const isManualCloseRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isOpen) {
      if (!isPushedRef.current) {
        try {
          window.history.pushState({ modalId, timestamp: Date.now() }, '');
          isPushedRef.current = true;
        } catch (e) {
          console.warn('[useModalBackHandler] pushState failed:', e);
        }
      }

      const handlePopState = (_event: PopStateEvent) => {
        if (isManualCloseRef.current) {
          // This popstate was triggered by our own history.back() on UI close
          isManualCloseRef.current = false;
          isPushedRef.current = false;
          return;
        }

        if (isPushedRef.current) {
          // Browser back was pressed while modal is open
          isPushedRef.current = false;
          onCloseRef.current();
        }
      };

      window.addEventListener('popstate', handlePopState);

      return () => {
        window.removeEventListener('popstate', handlePopState);

        // If unmounting or isOpen becomes false and we still held a pushed history entry,
        // cleanly pop it so history isn't polluted
        if (isPushedRef.current && !isManualCloseRef.current) {
          isManualCloseRef.current = true;
          isPushedRef.current = false;
          try {
            window.history.back();
          } catch (e) {
            console.warn('[useModalBackHandler] cleanup back failed:', e);
          }
        }
      };
    } else {
      // If was previously open and now closed via UI (props changed)
      if (isPushedRef.current) {
        isManualCloseRef.current = true;
        isPushedRef.current = false;
        try {
          window.history.back();
        } catch (e) {
          console.warn('[useModalBackHandler] manual close back failed:', e);
        }
      }
    }
  }, [isOpen, modalId]);

  const handleManualClose = useCallback(() => {
    if (isPushedRef.current) {
      isManualCloseRef.current = true;
      isPushedRef.current = false;
      try {
        window.history.back();
      } catch (e) {
        console.warn('[useModalBackHandler] handleManualClose back failed:', e);
      }
    }
    onCloseRef.current();
  }, []);

  return { handleManualClose };
}
