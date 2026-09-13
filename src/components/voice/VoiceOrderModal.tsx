import React, { useState, useEffect, useCallback } from 'react';
import { MenuItem } from '../../types/menu';
import { CartItem } from '../../types/cart';
import {
  VoiceState,
  VoiceLanguage,
  VoiceParseResult,
  MatchedItemResult,
  AmbiguousMatchResult,
  UnmatchedResult,
  VoiceRecognitionError
} from '../../services/voice/voiceTypes';
import { VoiceRecognitionService } from '../../services/voice/voiceRecognitionService';
import {
  matchVoiceTranscriptToMenu,
  mergeMatchedItemResults
} from '../../services/voice/voiceMenuMatcher';
import {
  isVoiceRecognitionSupported,
  checkMicrophonePermission,
  requestMicrophonePermission,
  MicrophonePermissionState
} from '../../services/voice/voiceSupport';
import { VoiceTranscript } from './VoiceTranscript';
import { VoiceMatchPreview } from './VoiceMatchPreview';
import { RestaurantOsAssistantCharacter } from './RestaurantOsAssistantCharacter';
import { VoiceConfirmation } from './VoiceConfirmation';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { auditService } from '../../services/auditService';
import {
  Mic,
  MicOff,
  X,
  Volume2,
  AlertCircle,
  Utensils,
  Radio,
  Sparkles,
  HelpCircle,
  RefreshCw
} from 'lucide-react';

interface VoiceOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  currencySymbol?: string;
  restaurantId: string;
  userRole?: string;
  userId?: string;
  userName?: string;
  onAddToCart: (itemsToAdd: { item: MenuItem; quantity: number }[]) => void;
  onClearCart?: () => void;
}

export const VoiceOrderModal: React.FC<VoiceOrderModalProps> = ({
  isOpen,
  onClose,
  menuItems,
  currencySymbol = '₹',
  restaurantId,
  userRole = 'staff',
  userId = 'system',
  userName = 'Staff User',
  onAddToCart,
  onClearCart
}) => {
  const [voiceService] = useState(() => new VoiceRecognitionService());
  const [voiceState, setVoiceState] = useState<VoiceState>('IDLE');
  const [language, setLanguage] = useState<VoiceLanguage>('auto');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<VoiceRecognitionError | null>(null);
  const [micPermissionState, setMicPermissionState] = useState<MicrophonePermissionState>('unknown');
  const [isCheckingPermission, setIsCheckingPermission] = useState(false);

  // Parsed results
  const [parseResult, setParseResult] = useState<VoiceParseResult | null>(null);
  const [matchedItems, setMatchedItems] = useState<MatchedItemResult[]>([]);
  const [ambiguousItems, setAmbiguousItems] = useState<AmbiguousMatchResult[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedResult[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Register Android / browser physical back-button hook
  useModalBackHandler(isOpen, onClose, 'voice-order-modal');

  // Check and observe microphone permission status
  useEffect(() => {
    if (!isOpen) return;
    let statusObj: PermissionStatus | null = null;

    const updatePermState = async () => {
      const st = await checkMicrophonePermission();
      setMicPermissionState(st);
      if (st === 'granted') {
        setError((prev) => (prev?.code === 'PERMISSION_DENIED' ? null : prev));
      }
    };

    updatePermState();

    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          statusObj = status;
          status.onchange = () => {
            updatePermState();
          };
        })
        .catch(() => {});
    }

    return () => {
      if (statusObj) {
        statusObj.onchange = null;
      }
    };
  }, [isOpen]);

  const handleAllowMicrophone = async () => {
    setIsCheckingPermission(true);
    try {
      const res = await requestMicrophonePermission();
      setMicPermissionState(res.state);
      if (res.granted) {
        setError(null);
        setVoiceState('IDLE');
        await voiceService.startListening(language);
      } else {
        setError({
          code: 'PERMISSION_DENIED',
          message: 'Microphone access is blocked. Allow microphone access in your browser/site settings to use Voice Ordering.',
          technicalDetails: 'Open browser Site Settings → Microphone → Allow'
        });
      }
    } catch {
      setMicPermissionState('denied');
      setError({
        code: 'PERMISSION_DENIED',
        message: 'Microphone access is blocked. Allow microphone access in your browser/site settings to use Voice Ordering.',
        technicalDetails: 'Open browser Site Settings → Microphone → Allow'
      });
    } finally {
      setIsCheckingPermission(false);
    }
  };

  const handleTryAgain = async () => {
    setIsCheckingPermission(true);
    try {
      const newState = await checkMicrophonePermission();
      if (newState === 'granted') {
        setMicPermissionState('granted');
        setError(null);
        setVoiceState('IDLE');
      } else if (newState === 'prompt') {
        const res = await requestMicrophonePermission();
        setMicPermissionState(res.state);
        if (res.granted) {
          setError(null);
          setVoiceState('IDLE');
        }
      } else {
        const res = await requestMicrophonePermission();
        setMicPermissionState(res.state);
        if (res.granted) {
          setError(null);
          setVoiceState('IDLE');
        } else {
          setError({
            code: 'PERMISSION_DENIED',
            message: 'Microphone access is blocked. Allow microphone access in your browser/site settings to use Voice Ordering.',
            technicalDetails: 'Open browser Site Settings → Microphone → Allow'
          });
        }
      }
    } catch {
      setMicPermissionState('denied');
    } finally {
      setIsCheckingPermission(false);
    }
  };

  // Parse speech transcript against menu
  const processTranscript = useCallback(
    (transcriptText: string, isFinal: boolean) => {
      if (!transcriptText || transcriptText.trim().length === 0) return;

      const result = matchVoiceTranscriptToMenu(
        transcriptText,
        menuItems,
        language,
        isFinal
      );

      setParseResult(result);
      setAmbiguousItems(result.ambiguousItems);
      setUnmatchedItems(result.unmatchedItems);

      if (isFinal) {
        if (result.action === 'CLEAR_CART') {
          setMatchedItems([]);
        } else if (result.matchedItems.length > 0) {
          setMatchedItems((prev) => mergeMatchedItemResults(prev, result.matchedItems));
        }
      }

      if (result.needsClarification) {
        setVoiceState('NEEDS_CLARIFICATION');
      } else if (result.requiresConfirmation || isFinal) {
        setVoiceState('CONFIRMATION');
      } else if (result.matchedItems.length > 0) {
        setVoiceState('MATCHED');
      } else {
        setVoiceState('PROCESSING');
      }
    },
    [menuItems, language]
  );

  // Setup speech recognition service callbacks
  useEffect(() => {
    voiceService.setCallbacks({
      onStateChange: (newState) => {
        setVoiceState(newState);
      },
      onInterimTranscript: (text) => {
        setInterimTranscript(text);
        setError(null);
        processTranscript(text, false);
      },
      onFinalTranscript: (text) => {
        setFinalTranscript(text);
        setInterimTranscript('');
        setError(null);
        processTranscript(text, true);
      },
      onError: (err) => {
        setError(err);
        setVoiceState('ERROR');
      }
    });

    return () => {
      voiceService.cancelListening();
    };
  }, [voiceService, processTranscript]);

  // Handle modal open / close cleanup
  useEffect(() => {
    if (!isOpen) {
      voiceService.cancelListening();
      setInterimTranscript('');
      setFinalTranscript('');
      setError(null);
      setParseResult(null);
      setMatchedItems([]);
      setAmbiguousItems([]);
      setUnmatchedItems([]);
      setVoiceState('IDLE');
    }
  }, [isOpen, voiceService]);

  const handleStartListening = async () => {
    setError(null);
    setInterimTranscript('');
    setFinalTranscript('');
    setParseResult(null);
    // Note: Do NOT reset matchedItems here; preserve existing voice-order draft!
    setAmbiguousItems([]);
    setUnmatchedItems([]);
    await voiceService.startListening(language);
  };

  const handleStopListening = () => {
    voiceService.stopListening();
  };

  const handleCancelListening = () => {
    voiceService.cancelListening();
  };

  // Quantity modification in matched items preview
  const handleUpdateMatchedQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveMatchedItem(index);
      return;
    }
    setMatchedItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantity: newQty };
      return next;
    });
  };

  // Remove individual matched item
  const handleRemoveMatchedItem = (index: number) => {
    setMatchedItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Resolve ambiguous match (e.g. user selects "Veg Biryani" out of 3 options)
  const handleResolveAmbiguity = (ambiguityIndex: number, selectedItem: MenuItem) => {
    const amb = ambiguousItems[ambiguityIndex];
    if (!amb) return;

    // Add resolved candidate to matched items draft
    const newMatched: MatchedItemResult = {
      menuItem: selectedItem,
      quantity: amb.quantity,
      confidence: 1.0,
      action: amb.action,
      matchType: 'EXACT'
    };

    setMatchedItems((prev) => mergeMatchedItemResults(prev, [newMatched]));
    setAmbiguousItems((prev) => prev.filter((_, i) => i !== ambiguityIndex));

    if (ambiguousItems.length <= 1) {
      setVoiceState('CONFIRMATION');
    }
  };

  // Confirm additions to cart
  const handleConfirmAction = async () => {
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      setVoiceState('ADDING_TO_CART');

      if (parseResult?.action === 'CLEAR_CART' && onClearCart) {
        onClearCart();
        // Record audit metadata
        await auditService.logEvent(restaurantId, {
          entityType: 'order',
          entityId: 'cart',
          action: 'order_updated',
          actorUid: userId,
          metadata: {
            userRole,
            userName,
            details: `Voice order action: Cleared cart. Transcript: "${finalTranscript || interimTranscript}"`
          }
        }).catch(() => {});
      } else if (matchedItems.length > 0) {
        const itemsToAdd = matchedItems.map((m) => ({
          item: m.menuItem,
          quantity: m.quantity
        }));

        onAddToCart(itemsToAdd);

        // Record audit metadata for voice-assisted cart operation
        await auditService.logEvent(restaurantId, {
          entityType: 'order',
          entityId: 'cart',
          action: 'order_created',
          actorUid: userId,
          metadata: {
            userRole,
            userName,
            details: `Voice-assisted items added to cart (${itemsToAdd.length} unique items). Transcript: "${finalTranscript || interimTranscript}"`
          }
        }).catch(() => {});
      }

      onClose();
    } catch (err) {
      console.error('[RestaurantOS Voice] Cart confirm error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const supported = isVoiceRecognitionSupported();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto select-none">
      <div
        id="voice-order-modal"
        aria-label="Voice Order Dialog"
        className="w-full sm:max-w-lg bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
      >
        {/* Modal Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3">
            <RestaurantOsAssistantCharacter state={voiceState} size="sm" showBadge={false} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  RestaurantOS Voice Assistant
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 rounded-full">
                  No-Gemini API
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Speak in Hindi or English (e.g. &ldquo;2 veg biryani aur 1 coke&rdquo;)
              </p>
            </div>
          </div>

          <button
            type="button"
            id="close-voice-modal-btn"
            onClick={onClose}
            aria-label="Close voice modal"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 no-scrollbar">
          {/* Unsupported Browser Warning */}
          {!supported && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-900">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <p className="font-bold mb-1">Browser Speech Recognition Unavailable</p>
                <p>
                  Voice ordering uses native device speech recognition. Please open RestaurantOS in Google Chrome, Microsoft Edge, or Android Chrome for speech recognition support.
                </p>
              </div>
            </div>
          )}

          {/* Permission Denied Card */}
          {(micPermissionState === 'denied' || error?.code === 'PERMISSION_DENIED') && (
            <div
              id="mic-permission-denied-card"
              className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl flex flex-col gap-3 text-amber-950 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-200/80 text-amber-800 flex items-center justify-center shrink-0 font-bold text-lg">
                  ⚠️
                </div>
                <div className="text-xs leading-relaxed space-y-1">
                  <h4 className="font-bold text-sm text-amber-900 tracking-tight">
                    Microphone access is blocked
                  </h4>
                  <p className="font-medium text-amber-800">
                    Allow microphone access in your browser/site settings to use Voice Ordering.
                  </p>
                  <div className="mt-2 p-2.5 bg-amber-100/80 rounded-xl font-mono text-[11px] text-amber-900 border border-amber-200">
                    <p className="font-bold mb-0.5">Microphone is blocked for this site.</p>
                    <p className="text-amber-800">Open browser Site Settings → Microphone → Allow.</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons with >=44px touch targets */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/80">
                <button
                  type="button"
                  id="allow-microphone-btn"
                  onClick={handleAllowMicrophone}
                  disabled={isCheckingPermission}
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <Mic className="w-4 h-4" />
                  <span>Allow Microphone</span>
                </button>

                <button
                  type="button"
                  id="try-again-mic-btn"
                  onClick={handleTryAgain}
                  disabled={isCheckingPermission}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingPermission ? 'animate-spin' : ''}`} />
                  <span>Try Again</span>
                </button>

                <button
                  type="button"
                  id="use-menu-instead-denied-btn"
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs border border-slate-200 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <Utensils className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Use Menu Instead</span>
                </button>
              </div>
            </div>
          )}

          {/* Other Error Banner (Non-Permission) */}
          {error && error.code !== 'PERMISSION_DENIED' && micPermissionState !== 'denied' && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-rose-900">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold">{error.message}</p>
                {error.technicalDetails && (
                  <p className="text-[10px] text-rose-600 font-mono mt-0.5">
                    {error.technicalDetails}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Transcript Display & Language Selector */}
          <VoiceTranscript
            state={voiceState}
            interimTranscript={interimTranscript}
            finalTranscript={finalTranscript}
            selectedLanguage={language}
            onLanguageChange={setLanguage}
          />

          {/* Microphone Action Control Button */}
          <div className="flex flex-col items-center justify-center py-2 space-y-2">
            {voiceState === 'LISTENING' ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  id="stop-listening-btn"
                  onClick={handleStopListening}
                  className="flex items-center gap-2 px-6 py-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-lg shadow-rose-200 active:scale-95 transition-all min-h-[48px]"
                >
                  <MicOff className="w-5 h-5 animate-pulse" />
                  <span>Done Speaking</span>
                </button>

                <button
                  type="button"
                  onClick={handleCancelListening}
                  className="px-4 py-3 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full min-h-[48px]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="start-listening-btn"
                onClick={handleStartListening}
                disabled={!supported}
                className={`flex items-center gap-2 px-6 py-3.5 rounded-full font-bold text-sm shadow-lg transition-all active:scale-95 min-h-[48px] ${
                  supported
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                }`}
              >
                <Mic className="w-5 h-5" />
                <span>{finalTranscript ? 'Tap to Speak Again' : 'Tap to Start Speaking'}</span>
              </button>
            )}

            <p className="text-[11px] text-slate-400 text-center font-medium">
              Only matches items from your active restaurant menu catalog
            </p>
          </div>

          {/* Matched Items & Ambiguity Resolver */}
          <VoiceMatchPreview
            matchedItems={matchedItems}
            ambiguousItems={ambiguousItems}
            unmatchedItems={unmatchedItems}
            overallAction={parseResult?.action || 'ADD_ITEM'}
            currencySymbol={currencySymbol}
            onUpdateQuantity={handleUpdateMatchedQuantity}
            onRemoveMatchedItem={handleRemoveMatchedItem}
            onResolveAmbiguity={handleResolveAmbiguity}
            onSpeakAgain={handleStartListening}
          />

          {/* Confirmation Box (Mandatory flow) */}
          {(matchedItems.length > 0 || parseResult?.action === 'CLEAR_CART') && (
            <VoiceConfirmation
              matchedItems={matchedItems}
              overallAction={parseResult?.action || 'ADD_ITEM'}
              currencySymbol={currencySymbol}
              isSubmitting={isSubmitting}
              onConfirm={handleConfirmAction}
              onCancel={() => {
                setMatchedItems([]);
                setParseResult(null);
                setVoiceState('IDLE');
              }}
              onSpeakMore={handleStartListening}
            />
          )}
        </div>

        {/* Modal Footer: Fallback to manual menu */}
        <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0 pb-safe">
          <button
            type="button"
            id="use-menu-instead-btn"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-all min-h-[44px]"
          >
            <Utensils className="w-4 h-4 text-indigo-600" />
            <span>Use Menu Instead</span>
          </button>

          <span className="text-[11px] text-slate-400 font-medium">
            Strict Confirmation Active
          </span>
        </div>
      </div>
    </div>
  );
};
