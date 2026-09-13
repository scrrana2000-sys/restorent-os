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
  Globe
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

interface VoiceAssistantWidgetProps {
  menuItems: MenuItem[];
  currencySymbol?: string;
  onAddToCart: (itemsToAdd: { item: MenuItem; quantity: number }[]) => void;
  onClearCart?: () => void;
  className?: string;
}

export const VoiceAssistantWidget: React.FC<VoiceAssistantWidgetProps> = ({
  menuItems,
  currencySymbol = '₹',
  onAddToCart,
  onClearCart,
  className = ''
}) => {
  // Settings & Storage State
  const [settings, setSettings] = useState<VoiceAssistantSettings>(getVoiceAssistantSettings);
  const [showIntroBubble, setShowIntroBubble] = useState<boolean>(!isAssistantIntroShown());
  const [isWaving, setIsWaving] = useState<boolean>(!isAssistantIntroShown());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [permissionPromptOpen, setPermissionPromptOpen] = useState<boolean>(false);

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

  // Modal Back Handler for Settings & Permission Drawer
  useModalBackHandler(isSettingsOpen, () => setIsSettingsOpen(false), 'voice-assistant-settings');
  useModalBackHandler(permissionPromptOpen, () => setPermissionPromptOpen(false), 'voice-assistant-perm-prompt');

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
  }, [settings.enabled, settings.alwaysListening, settings.language, settings.spokenResponses, menuItems]);

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

  // Handle Transcript Processing against Menu Catalog
  const handleProcessTranscript = (transcript: string) => {
    if (!transcript.trim()) return;

    setVoiceState('PROCESSING');
    setSpeechBubbleText('Menu check kar raha hoon...');

    const result = matchVoiceTranscriptToMenu(transcript, menuItems, settings.language, true);

    if (result.action === 'CLEAR_CART') {
      setPendingAction('CLEAR_CART');
      setVoiceState('CONFIRMATION');
      const text = 'Kya aap poora cart clear karna chahte hain?';
      setSpeechBubbleText(text);
      defaultVoiceTtsService.speak(text, settings.language, { enabled: settings.spokenResponses });
      return;
    }

    // Merge matched items into existing draft
    if (result.matchedItems.length > 0) {
      setDraftMatchedItems((prev) => mergeMatchedItemResults(prev, result.matchedItems));
    }

    setAmbiguousCandidates(result.ambiguousItems);
    setUnmatchedItems(result.unmatchedItems);

    if (result.needsClarification && result.ambiguousItems.length > 0) {
      setVoiceState('NEEDS_CLARIFICATION');
      const amb = result.ambiguousItems[0];
      const text = `Kaunsi ${amb.rawQuery} chahiye? Kripya select karein:`;
      setSpeechBubbleText(text);
      defaultVoiceTtsService.speak(text, settings.language, { enabled: settings.spokenResponses });
    } else if (result.matchedItems.length > 0 || draftMatchedItems.length > 0) {
      setVoiceState('CONFIRMATION');
      const combined = mergeMatchedItemResults(draftMatchedItems, result.matchedItems);
      const itemsDesc = combined
        .map((m) => `${m.quantity} ${m.menuItem.shortName || m.menuItem.name}`)
        .join(', ');
      const text = `Mainne ${itemsDesc} suna hai. Cart mein add kar doon?`;
      setSpeechBubbleText(text);
      defaultVoiceTtsService.speak(text, settings.language, { enabled: settings.spokenResponses });
    } else if (result.unmatchedItems.length > 0) {
      setVoiceState('ERROR');
      const text = `Sorry, "${result.unmatchedItems[0].rawQuery}" humare menu mein nahi mila. Dobara bolye!`;
      setSpeechBubbleText(text);
      defaultVoiceTtsService.speak(text, settings.language, { enabled: settings.spokenResponses });
    } else {
      setVoiceState('IDLE');
      setSpeechBubbleText('Order dena ho to mujhe boliye!');
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

  // Confirm and Add Draft to Cart (Double-submit guarded)
  const handleConfirmAddToCart = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    if (pendingAction === 'CLEAR_CART') {
      onClearCart?.();
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
      onAddToCart(itemsToAdd);

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
        setSpeechBubbleText('Aur kuch order karna hai?');
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

  return (
    <>
      {/* Outer Fixed Assistant Dock (Bottom-Left) */}
      <div
        id="restaurantos-voice-assistant-dock"
        className={`fixed bottom-16 sm:bottom-4 left-3 sm:left-4 z-30 flex flex-col items-start gap-2 pointer-events-none ${className}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Interactive Speech Bubble attached to Character */}
        {(speechBubbleText || showIntroBubble || voiceState === 'CONFIRMATION' || voiceState === 'NEEDS_CLARIFICATION') && (
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
                <span>RestaurantOS Assistant</span>
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
                {showIntroBubble && (
                  <button
                    type="button"
                    onClick={() => handleDismissIntro(false)}
                    className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600 transition"
                    title="Close bubble"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Main Speech Text */}
            <p className="font-medium text-gray-700 leading-snug mb-2">{speechBubbleText}</p>

            {/* 1. Clarification Candidates Selection */}
            {voiceState === 'NEEDS_CLARIFICATION' && ambiguousCandidates.length > 0 && (
              <div className="space-y-1.5 my-2">
                <p className="text-[11px] font-semibold text-amber-700">Select options:</p>
                <div className="flex flex-wrap gap-1.5">
                  {ambiguousCandidates[0].candidates.map((cand) => (
                    <button
                      key={cand.itemId}
                      type="button"
                      onClick={() => handleSelectAmbiguousCandidate(cand, 0)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 font-bold text-xs border border-indigo-200 transition active:scale-95"
                    >
                      {cand.shortName || cand.name} ({currencySymbol}
                      {cand.price})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Confirmation Action Buttons */}
            {voiceState === 'CONFIRMATION' && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  id="voice-assistant-confirm-btn"
                  onClick={handleConfirmAddToCart}
                  disabled={isSubmitting}
                  className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-xs active:scale-95 transition flex items-center justify-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{pendingAction === 'CLEAR_CART' ? 'Yes, Clear' : 'Yes, Add to Cart'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVoiceState('IDLE');
                    setDraftMatchedItems([]);
                    setPendingAction('NONE');
                    setSpeechBubbleText('Cancelled! Kuch aur order dena hai?');
                  }}
                  className="py-1.5 px-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold text-xs transition active:scale-95"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* 3. Intro Action Buttons */}
            {showIntroBubble && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    handleDismissIntro(true);
                    handleStartListening();
                  }}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-bold transition shadow-2xs"
                >
                  Enable Voice Assistant
                </button>
                <button
                  type="button"
                  onClick={() => handleDismissIntro(true)}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-xs font-medium transition"
                >
                  Got it
                </button>
              </div>
            )}
          </div>
        )}

        {/* Character & Action Control Dock Bar */}
        <div className="pointer-events-auto flex items-center gap-2 bg-white/95 backdrop-blur-md p-1.5 pr-3 rounded-full border border-indigo-100 shadow-lg">
          {/* Animated Character Avatar */}
          <RestaurantOsAssistantCharacter
            state={voiceState}
            isWaving={isWaving}
            size="sm"
            onClick={isListening ? handleStopListening : handleStartListening}
          />

          {/* Quick Mic Action & Status Toggle */}
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-800">Voice Assistant</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  isListening
                    ? 'bg-rose-500 animate-ping'
                    : settings.enabled
                    ? 'bg-emerald-500'
                    : 'bg-gray-300'
                }`}
              />
            </div>
            <span className="text-[10px] text-gray-500 font-medium">
              {isListening
                ? '🎙 Listening...'
                : settings.enabled
                ? 'Tap mic or say order'
                : '🔇 Assistant Off'}
            </span>
          </div>

          {/* Action Mic Toggle Button */}
          <button
            type="button"
            id="voice-assistant-main-mic-btn"
            onClick={isListening ? handleStopListening : handleStartListening}
            className={`p-2 rounded-full transition active:scale-95 ml-1 ${
              isListening
                ? 'bg-rose-500 text-white shadow-md shadow-rose-200 animate-pulse'
                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
            }`}
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
            title={isListening ? 'Mute Microphone' : 'Start Voice Order'}
          >
            {isListening ? <Mic className="w-4 h-4 animate-bounce" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Settings Trigger */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"
            title="Assistant Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Permission Request Modal */}
      {permissionPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-gray-100 space-y-4 text-center">
            <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto text-indigo-600">
              <Mic className="w-6 h-6 animate-pulse" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Enable Voice Assistant</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Voice Assistant ko order sunne aur cart mein add karne ke liye microphone access permission chahiye.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  setPermissionPromptOpen(false);
                  if (voiceServiceRef.current) {
                    await voiceServiceRef.current.startListening(settings.language);
                  }
                }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition active:scale-98"
              >
                Allow & Start Listening
              </button>
              <button
                type="button"
                onClick={() => setPermissionPromptOpen(false)}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium text-xs transition"
              >
                Not Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal Drawer */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 max-w-md w-full shadow-2xl border border-gray-100 space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm">
                <Settings className="w-4 h-4" />
                <span>Voice Assistant Settings</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-gray-700">
              {/* Voice Assistant Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                <div>
                  <p className="font-bold text-gray-900">Voice Assistant</p>
                  <p className="text-[11px] text-gray-500">Enable smart voice order assistant</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateSettings({ enabled: !settings.enabled })}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition ${
                    settings.enabled ? 'bg-indigo-600 justify-end' : 'bg-gray-300 justify-start'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Hands-Free Always Listening */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                <div>
                  <p className="font-bold text-gray-900">Always Listening (Hands-free)</p>
                  <p className="text-[11px] text-gray-500">Auto-restarts listening after order confirmation</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateSettings({ alwaysListening: !settings.alwaysListening })}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition ${
                    settings.alwaysListening ? 'bg-indigo-600 justify-end' : 'bg-gray-300 justify-start'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Spoken Responses TTS */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                <div>
                  <p className="font-bold text-gray-900">Spoken Voice Responses (TTS)</p>
                  <p className="text-[11px] text-gray-500">Speak assistant replies through device speaker</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !settings.spokenResponses;
                    updateSettings({ spokenResponses: next });
                    defaultVoiceTtsService.setEnabled(next);
                  }}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition ${
                    settings.spokenResponses ? 'bg-indigo-600 justify-end' : 'bg-gray-300 justify-start'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Recognition Language Selector */}
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-gray-900">
                  <Globe className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Voice Recognition Language</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'auto', label: 'Auto (Hinglish)' },
                    { id: 'hi-IN', label: 'Hindi (हिंदी)' },
                    { id: 'en-IN', label: 'English (India)' }
                  ].map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => updateSettings({ language: l.id as VoiceLanguage })}
                      className={`py-2 px-2 rounded-lg font-bold text-[11px] transition text-center border ${
                        settings.language === l.id
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs transition"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
