import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Settings,
  X,
  Check,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  HelpCircle,
  ChevronDown,
  Globe,
  Send,
  Compass,
  ArrowRight
} from 'lucide-react';
import { MenuItem } from '../../types/menu';
import {
  VoiceState,
  VoiceLanguage,
  VoiceRecognitionError,
  MatchedItemResult
} from '../../services/voice/voiceTypes';
import { VoiceRecognitionService } from '../../services/voice/voiceRecognitionService';
import { matchVoiceTranscriptToMenu, mergeMatchedItemResults } from '../../services/voice/voiceMenuMatcher';
import { defaultVoiceTtsService } from '../../services/voice/voiceTtsService';
import {
  getVoiceAssistantSettings,
  saveVoiceAssistantSettings,
  isAssistantIntroShown,
  markAssistantIntroShown,
  VoiceAssistantSettings
} from '../../services/voice/voiceSettings';
import { isVoiceRecognitionSupported, checkMicrophonePermission } from '../../services/voice/voiceSupport';
import { RestaurantOsAssistantCharacter } from './RestaurantOsAssistantCharacter';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { useAuth } from '../../context/AuthContext';
import { useRestaurant } from '../../context/RestaurantContext';
import { interpretGlobalVoiceCommand } from '../../services/voice/globalVoiceInterpreter';
import { AdminView } from '../layout/Sidebar';
import { isViewAllowed } from '../../utils/permissions';

export interface VoiceAssistantWidgetProps {
  currentView?: string;
  onNavigate?: (view: AdminView) => void;
  menuItems?: MenuItem[];
  currencySymbol?: string;
  onAddToCart?: (itemsToAdd: { item: MenuItem; quantity: number }[]) => void;
  onClearCart?: () => void;
  className?: string;
}

export const VoiceAssistantWidget: React.FC<VoiceAssistantWidgetProps> = ({
  currentView: propCurrentView,
  onNavigate,
  menuItems: propsMenuItems,
  currencySymbol: propsCurrencySymbol,
  onAddToCart: propsOnAddToCart,
  onClearCart: propsOnClearCart,
  className = ''
}) => {
  // Context hooks (safe fallback if rendered outside contexts in tests)
  const authContext = useAuth();
  const restaurantContext = useRestaurant();

  const user = authContext?.user || null;
  const profile = authContext?.profile || null;
  const userRole = profile?.role || 'owner';

  const restaurant = restaurantContext?.restaurant || null;
  const contextMenuItems = restaurantContext?.menuItems || [];
  const effectiveMenuItems = propsMenuItems || contextMenuItems || [];
  const effectiveCurrencySymbol = propsCurrencySymbol || restaurant?.currencySymbol || '₹';
  const effectiveRestaurantId = restaurant?.id || profile?.restaurantId || 'rest_default';
  const effectiveView = propCurrentView || 'pos';

  // Settings & Storage State
  const [settings, setSettings] = useState<VoiceAssistantSettings>(getVoiceAssistantSettings);
  const [showIntroBubble, setShowIntroBubble] = useState<boolean>(!isAssistantIntroShown());
  const [isWaving, setIsWaving] = useState<boolean>(!isAssistantIntroShown());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [permissionPromptOpen, setPermissionPromptOpen] = useState<boolean>(false);
  const [isExpandedPanelOpen, setIsExpandedPanelOpen] = useState<boolean>(false);

  // Text fallback input
  const [textInput, setTextInput] = useState<string>('');

  // Assistant & Voice Engine State
  const [voiceState, setVoiceState] = useState<VoiceState>(settings.enabled ? 'IDLE' : 'OFF');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [speechBubbleText, setSpeechBubbleText] = useState<string>('');
  const [errorDetails, setErrorDetails] = useState<VoiceRecognitionError | null>(null);

  // Voice Order Draft State
  const [draftMatchedItems, setDraftMatchedItems] = useState<MatchedItemResult[]>([]);
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<{
    rawQuery: string;
    quantity: number;
    candidates: MenuItem[];
  }[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<{ rawQuery: string; reason: string }[]>([]);
  const [pendingAction, setPendingAction] = useState<'CLEAR_CART' | 'NONE'>('NONE');

  // Double-submit & auto-restart safety guards
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const restartCountRef = useRef<number>(0);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const voiceServiceRef = useRef<VoiceRecognitionService | null>(null);

  // Modal Back Handler for Settings, Permission Drawer & Panel
  useModalBackHandler(isSettingsOpen, () => setIsSettingsOpen(false), 'voice-assistant-settings');
  useModalBackHandler(permissionPromptOpen, () => setPermissionPromptOpen(false), 'voice-assistant-perm-prompt');
  useModalBackHandler(isExpandedPanelOpen, () => setIsExpandedPanelOpen(false), 'voice-assistant-expanded-panel');

  // Initialize VoiceRecognitionService
  useEffect(() => {
    const service = new VoiceRecognitionService({
      onStateChange: (newState) => {
        if (settings.enabled) {
          setVoiceState(newState);
        }
      },
      onInterimTranscript: (text) => {
        setInterimTranscript(text);
        if (text) {
          setSpeechBubbleText(`Main sun raha hoon: "${text}"`);
        }
      },
      onFinalTranscript: (text) => {
        setFinalTranscript(text);
        setInterimTranscript('');
        handleProcessTranscript(text);
      },
      onError: (err) => {
        setErrorDetails(err);
        setVoiceState('ERROR');
        const errMsg = err.message || 'Speech recognition issue. Please speak again.';
        setSpeechBubbleText(`Sorry, ${errMsg}`);
        defaultVoiceTtsService.speak(`Sorry, ${errMsg}`, settings.language, { enabled: settings.spokenResponses });
      },
      onEnd: () => {
        // Continuous listening auto-restart logic
        if (settings.enabled && settings.alwaysListening && !isSubmitting) {
          scheduleAutoRestart();
        }
      }
    });

    voiceServiceRef.current = service;

    return () => {
      service.cancelListening();
      defaultVoiceTtsService.stop();
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, [settings.enabled, settings.alwaysListening, settings.language, settings.spokenResponses, effectiveMenuItems]);

  // Initial Intro Greeting
  useEffect(() => {
    if (!isAssistantIntroShown()) {
      setVoiceState('entering');
      const walkTimer = setTimeout(() => {
        setVoiceState('wave');
        setIsWaving(true);
        const greeting = 'Hi! 👋 Main RestaurantOS ka Voice Assistant hoon.';
        setSpeechBubbleText(greeting);
        defaultVoiceTtsService.speak('Hi! Main RestaurantOS ka Voice Assistant hoon.', settings.language, { enabled: settings.spokenResponses });

        setTimeout(() => {
          setIsWaving(false);
          setVoiceState('IDLE');
        }, 3000);
      }, 1000);

      return () => clearTimeout(walkTimer);
    } else {
      setSpeechBubbleText('Hi! 👋 Main RestaurantOS ka Voice Assistant hoon.');
    }
  }, []);

  // Stop mic & TTS immediately if user logs out or user session ends
  useEffect(() => {
    if (!user) {
      if (voiceServiceRef.current) {
        voiceServiceRef.current.cancelListening();
      }
      defaultVoiceTtsService.stop();
      setVoiceState('OFF');
    }
  }, [user]);

  // Safe Continuous Restart with Exponential Backoff Guard
  const scheduleAutoRestart = useCallback(() => {
    if (restartCountRef.current > 3) {
      console.warn('[RestaurantOS Voice] Exceeded auto-restart limit. Stopping continuous loop.');
      return;
    }
    restartCountRef.current += 1;
    restartTimerRef.current = setTimeout(() => {
      if (voiceServiceRef.current && settings.enabled && settings.alwaysListening) {
        voiceServiceRef.current.startListening(settings.language);
      }
    }, 1200);

    // Reset counter after 10 seconds of stability
    setTimeout(() => {
      restartCountRef.current = 0;
    }, 10000);
  }, [settings.enabled, settings.alwaysListening, settings.language]);

  // Handle Transcript Processing against Global Context & Menu Catalog
  const handleProcessTranscript = async (transcript: string) => {
    if (!transcript.trim()) return;

    setVoiceState('PROCESSING');
    setSpeechBubbleText('Command check kar raha hoon...');

    try {
      const result = await interpretGlobalVoiceCommand(
        transcript,
        effectiveView,
        userRole,
        effectiveRestaurantId,
        effectiveMenuItems,
        settings.language
      );

      if (result.intent === 'NAVIGATE' && result.targetView) {
        setVoiceState('SUCCESS');
        setSpeechBubbleText(result.responseText);
        defaultVoiceTtsService.speak(result.responseText, settings.language, { enabled: settings.spokenResponses });
        if (onNavigate) {
          onNavigate(result.targetView as AdminView);
        }
        return;
      }

      if (result.intent === 'CLEAR_CART') {
        setPendingAction('CLEAR_CART');
        setVoiceState('CONFIRMATION');
        setSpeechBubbleText(result.responseText);
        defaultVoiceTtsService.speak(result.responseText, settings.language, { enabled: settings.spokenResponses });
        return;
      }

      if (result.intent === 'POS_ORDER') {
        if (result.matchedItems && result.matchedItems.length > 0) {
          setDraftMatchedItems((prev) => mergeMatchedItemResults(prev, result.matchedItems!));
        }
        if (result.ambiguousItems) {
          setAmbiguousCandidates(result.ambiguousItems);
        }

        if (result.ambiguousItems && result.ambiguousItems.length > 0) {
          setVoiceState('NEEDS_CLARIFICATION');
        } else {
          setVoiceState('CONFIRMATION');
        }
        setSpeechBubbleText(result.responseText);
        defaultVoiceTtsService.speak(result.responseText, settings.language, { enabled: settings.spokenResponses });
        return;
      }

      if (result.intent === 'INVENTORY_QUERY' || result.intent === 'REPORTS_QUERY' || result.intent === 'KITCHEN_QUERY') {
        setVoiceState('SUCCESS');
        setSpeechBubbleText(result.responseText);
        defaultVoiceTtsService.speak(result.responseText, settings.language, { enabled: settings.spokenResponses });
        return;
      }

      if (result.intent === 'RBAC_REJECTED' || result.intent === 'SECURITY_REJECTED') {
        setVoiceState('ERROR');
        setSpeechBubbleText(result.responseText);
        defaultVoiceTtsService.speak(result.responseText, settings.language, { enabled: settings.spokenResponses });
        return;
      }

      // Default unmatched fallback
      setVoiceState('ERROR');
      setSpeechBubbleText(result.responseText);
      defaultVoiceTtsService.speak(result.responseText, settings.language, { enabled: settings.spokenResponses });
    } catch (err) {
      console.warn('[GlobalVoiceAssistant] Interpreter error:', err);
      setVoiceState('ERROR');
      setSpeechBubbleText('Command processing mein error aayi.');
    }
  };

  // Start Listening Helper
  const handleStartListening = async () => {
    if (!settings.enabled) {
      updateSettings({ enabled: true });
    }

    // Check microphone permission first
    const perm = await checkMicrophonePermission();
    if (perm === 'prompt' || perm === 'denied') {
      setPermissionPromptOpen(true);
      return;
    }

    if (voiceServiceRef.current) {
      setErrorDetails(null);
      setSpeechBubbleText('Main sun raha hoon...');
      defaultVoiceTtsService.stop();
      await voiceServiceRef.current.startListening(settings.language);
    }
  };

  // Stop / Mute Voice Helper
  const handleStopListening = () => {
    if (voiceServiceRef.current) {
      voiceServiceRef.current.cancelListening();
    }
    defaultVoiceTtsService.stop();
    setVoiceState('OFF');
    setSpeechBubbleText('Voice Assistant muted. Tap mic to wake!');
  };

  // Confirm and Add Draft to Cart / Execute Action (Double-submit guarded)
  const handleConfirmAddToCart = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    if (pendingAction === 'CLEAR_CART') {
      if (propsOnClearCart) {
        propsOnClearCart();
      } else {
        window.dispatchEvent(new CustomEvent('ros-voice-clear-cart'));
      }
      setPendingAction('NONE');
      setVoiceState('SUCCESS');
      const text = 'Cart poora clear kar diya gaya hai.';
      setSpeechBubbleText(text);
      defaultVoiceTtsService.speak(text, settings.language, { enabled: settings.spokenResponses });
    } else if (draftMatchedItems.length > 0) {
      const itemsToAdd = draftMatchedItems.map((m) => ({
        item: m.menuItem,
        quantity: m.quantity
      }));

      // Auto-navigate to POS if currently in another view
      if (effectiveView !== 'pos' && onNavigate && isViewAllowed(userRole, 'pos')) {
        onNavigate('pos');
      }

      if (propsOnAddToCart) {
        propsOnAddToCart(itemsToAdd);
      } else {
        window.dispatchEvent(new CustomEvent('ros-voice-add-to-cart', { detail: { itemsToAdd } }));
      }

      setVoiceState('SUCCESS');
      const count = draftMatchedItems.reduce((s, i) => s + i.quantity, 0);
      const text = `Done! ${count} items cart mein add kar diye hain. ✨`;
      setSpeechBubbleText(text);
      defaultVoiceTtsService.speak(text, settings.language, { enabled: settings.spokenResponses });
      setDraftMatchedItems([]);
    }

    setTimeout(() => {
      setIsSubmitting(false);
      if (settings.alwaysListening) {
        handleStartListening();
      } else {
        setVoiceState('IDLE');
        setSpeechBubbleText('Aur kuch help chahiye?');
      }
    }, 2500);
  };

  // Resolve Ambiguity Selection
  const handleSelectAmbiguousCandidate = (selectedItem: MenuItem, ambIndex: number) => {
    const amb = ambiguousCandidates[ambIndex];
    if (!amb) return;

    const newMatched: MatchedItemResult = {
      menuItem: selectedItem,
      quantity: amb.quantity,
      confidence: 0.95,
      matchType: 'EXACT',
      action: 'ADD_ITEM'
    };

    const updatedDraft = mergeMatchedItemResults(draftMatchedItems, [newMatched]);
    setDraftMatchedItems(updatedDraft);

    const remainingAmb = ambiguousCandidates.filter((_, i) => i !== ambIndex);
    setAmbiguousCandidates(remainingAmb);

    if (remainingAmb.length === 0) {
      setVoiceState('CONFIRMATION');
      const itemsDesc = updatedDraft
        .map((m) => `${m.quantity} ${m.menuItem.shortName || m.menuItem.name}`)
        .join(', ');
      const text = `Ok! Total ${itemsDesc}. Cart mein add kar doon?`;
      setSpeechBubbleText(text);
      defaultVoiceTtsService.speak(text, settings.language, { enabled: settings.spokenResponses });
    }
  };

  // Handle Text Fallback Submission
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const text = textInput;
    setTextInput('');
    handleProcessTranscript(text);
  };

  // Dismiss Intro & Save Preference
  const handleDismissIntro = (dontShowAgain = false) => {
    setShowIntroBubble(false);
    if (dontShowAgain) {
      markAssistantIntroShown();
    }
  };

  // Settings Updater
  const updateSettings = (newPartial: Partial<VoiceAssistantSettings>) => {
    const updated = saveVoiceAssistantSettings(newPartial);
    setSettings(updated);
    if (!updated.enabled) {
      handleStopListening();
    }
  };

  const isListening = voiceState === 'LISTENING' || voiceState === 'HEARING';

  // Contextual Suggestion Chips based on view
  const getContextualSuggestions = () => {
    if (effectiveView === 'pos') {
      return ['2 Veg Biryani', 'Clear Cart', 'Kitchen View'];
    } else if (effectiveView === 'kitchen') {
      return ['Kitchen Status', 'POS View', 'Orders Page'];
    } else if (effectiveView === 'inventory') {
      return ['Rice Stock', 'Paneer Stock', 'POS View'];
    } else if (effectiveView === 'reports') {
      return ['Today Sales', 'POS View', 'Inventory View'];
    } else if (effectiveView === 'captain') {
      return ['Table Status', 'POS View', 'Kitchen View'];
    }
    return ['POS View', 'Kitchen View', 'Inventory View', 'Today Sales'];
  };

  return (
    <>
      {/* Outer Fixed Assistant Dock (Bottom-Left on mobile, left of content on desktop) */}
      <div
        id="restaurantos-voice-assistant-dock"
        className={`fixed bottom-16 sm:bottom-4 left-3 sm:left-4 lg:left-72 z-40 flex flex-col items-start gap-2 pointer-events-none ${className}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Interactive Speech Bubble & Compact Assistant Panel attached to Character */}
        {(speechBubbleText || showIntroBubble || voiceState === 'CONFIRMATION' || voiceState === 'NEEDS_CLARIFICATION' || isExpandedPanelOpen) && (
          <div
            id="voice-assistant-speech-bubble"
            className="pointer-events-auto max-w-[280px] sm:max-w-[340px] bg-white border border-indigo-100 rounded-2xl p-3 shadow-xl text-xs sm:text-sm text-gray-800 animate-in fade-in slide-in-from-bottom-2 duration-300 relative mb-1"
          >
            {/* Tail */}
            <div className="absolute -bottom-2 left-6 w-4 h-4 bg-white border-b border-r border-indigo-100 transform rotate-45" />

            {/* Bubble Header Bar */}
            <div className="flex items-center justify-between mb-1.5 border-b border-gray-100 pb-1">
              <div className="flex items-center gap-1.5 text-indigo-700 font-bold text-xs">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>RestaurantOS Voice Assistant</span>
                <span className="text-[10px] px-1.5 py-0.2 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100 uppercase tracking-wider font-semibold">
                  {effectiveView}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="p-1 hover:bg-gray-100 rounded-md text-gray-500 hover:text-gray-700 transition"
                  title="Voice Settings"
                  aria-label="Voice Settings"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleDismissIntro(false);
                    setSpeechBubbleText('');
                  }}
                  className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600 transition"
                  title="Close bubble"
                  aria-label="Close bubble"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Main Speech Text */}
            <p className="font-medium text-gray-700 leading-snug mb-2">{speechBubbleText}</p>

            {/* Clarification Candidates Selection */}
            {voiceState === 'NEEDS_CLARIFICATION' && ambiguousCandidates.length > 0 && (
              <div className="space-y-1.5 my-2">
                <p className="text-[11px] font-semibold text-amber-700">Select option:</p>
                <div className="flex flex-wrap gap-1.5">
                  {ambiguousCandidates[0].candidates.map((cand) => (
                    <button
                      key={cand.itemId}
                      type="button"
                      onClick={() => handleSelectAmbiguousCandidate(cand, 0)}
                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 rounded-lg text-xs font-medium transition"
                    >
                      {cand.shortName || cand.name} ({effectiveCurrencySymbol}{cand.price})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Confirmation Controls */}
            {voiceState === 'CONFIRMATION' && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleConfirmAddToCart}
                  disabled={isSubmitting}
                  className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1 shadow-sm transition disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm Action</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftMatchedItems([]);
                    setPendingAction('NONE');
                    setVoiceState('IDLE');
                    setSpeechBubbleText('Cancelled. Main aapki aur kya help karoon?');
                  }}
                  className="py-1.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Text Fallback Input Field */}
            <form onSubmit={handleTextSubmit} className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type command or query..."
                className="flex-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-indigo-500 focus:bg-white"
              />
              <button
                type="submit"
                disabled={!textInput.trim()}
                className="p-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl transition"
                title="Send command"
              >
                <Send className="w-3 h-3" />
              </button>
            </form>

            {/* Quick Contextual Action Chips & Manual Action */}
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {getContextualSuggestions().map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => handleProcessTranscript(sug)}
                  className="px-2 py-0.5 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 rounded-md text-[10px] font-medium transition"
                >
                  {sug}
                </button>
              ))}
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(effectiveView === 'pos' ? 'kitchen' : 'pos')}
                  className="ml-auto px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[10px] font-medium flex items-center gap-0.5 transition"
                >
                  <span>Use Menu Instead</span>
                  <ArrowRight className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Character Visual Anchor & Main Toggle Button */}
        <div className="pointer-events-auto flex items-end gap-2">
          <RestaurantOsAssistantCharacter
            state={voiceState}
            isWaving={isWaving}
            onClick={() => {
              if (!isListening && voiceState !== 'PROCESSING') {
                handleStartListening();
              } else {
                handleStopListening();
              }
            }}
            className="shadow-2xl"
          />

          {/* Floating Mic Control Button */}
          <button
            type="button"
            id="voice-assistant-main-mic-btn"
            onClick={() => {
              if (isListening) {
                handleStopListening();
              } else {
                handleStartListening();
              }
            }}
            className={`p-2.5 sm:p-3 rounded-2xl text-white shadow-lg flex items-center justify-center transition-all transform hover:scale-105 active:scale-95 ${
              isListening
                ? 'bg-rose-500 hover:bg-rose-600 ring-4 ring-rose-200 animate-pulse'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
            title={isListening ? 'Stop Listening' : 'Wake Voice Assistant'}
            aria-label={isListening ? 'Stop Listening' : 'Wake Voice Assistant'}
          >
            {isListening ? <Mic className="w-4 h-4 sm:w-5 sm:h-5" /> : <MicOff className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
        </div>
      </div>

      {/* Settings Modal Drawer */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <div className="flex items-center gap-2 text-indigo-900 font-bold text-sm">
                <Settings className="w-4 h-4 text-indigo-600" />
                <span>Voice Assistant Settings</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Language Selection */}
              <div>
                <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Speech Recognition Language</span>
                </label>
                <select
                  value={settings.language}
                  onChange={(e) => updateSettings({ language: e.target.value as VoiceLanguage })}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-800 focus:outline-none focus:border-indigo-500"
                >
                  <option value="auto">Auto-detect (Hinglish / English / Hindi)</option>
                  <option value="hi-IN">Hindi (हिंदी - दो वेज बिरयानी)</option>
                  <option value="en-IN">English (Indian Accent)</option>
                </select>
              </div>

              {/* Always Listening Toggle */}
              <div className="flex items-center justify-between p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                <div>
                  <p className="font-semibold text-indigo-950">Always Listening</p>
                  <p className="text-[10px] text-indigo-700 mt-0.5">Keeps mic ready across pages</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.alwaysListening}
                  onChange={(e) => updateSettings({ alwaysListening: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                />
              </div>

              {/* Spoken TTS Responses */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <p className="font-semibold text-gray-800">Spoken Voice Responses (TTS)</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Assistant speaks confirmations aloud</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.spokenResponses}
                  onChange={(e) => updateSettings({ spokenResponses: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(false)}
              className="mt-5 w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Permission Request Prompt Drawer */}
      {permissionPromptOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-gray-100 text-center">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <Mic className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Microphone Access Required</h3>
            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
              RestaurantOS Assistant needs microphone access to listen to your voice commands. Please allow microphone access in your browser prompt.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  setPermissionPromptOpen(false);
                  if (voiceServiceRef.current) {
                    await voiceServiceRef.current.startListening(settings.language);
                  }
                }}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition"
              >
                Allow & Start
              </button>
              <button
                type="button"
                onClick={() => setPermissionPromptOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
