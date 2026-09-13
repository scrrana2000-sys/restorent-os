import React from 'react';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import { isVoiceRecognitionSupported } from '../../services/voice/voiceSupport';

interface VoiceOrderButtonProps {
  onClick: () => void;
  isListening?: boolean;
  className?: string;
  variant?: 'header' | 'floating' | 'inline' | 'compact';
  disabled?: boolean;
}

export const VoiceOrderButton: React.FC<VoiceOrderButtonProps> = ({
  onClick,
  isListening = false,
  className = '',
  variant = 'header',
  disabled = false
}) => {
  const supported = isVoiceRecognitionSupported();

  if (variant === 'compact') {
    return (
      <button
        type="button"
        id="voice-order-btn-compact"
        onClick={onClick}
        disabled={disabled}
        className={`flex items-center justify-center min-h-[44px] min-w-[44px] p-2 rounded-xl transition-all active:scale-95 ${
          isListening
            ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-200'
            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
        } ${className}`}
        aria-label={isListening ? 'Voice ordering listening' : 'Start voice ordering'}
        title="Voice Order (Hindi / English)"
      >
        {isListening ? (
          <Mic className="w-5 h-5 animate-bounce" />
        ) : (
          <Mic className="w-5 h-5 text-indigo-600" />
        )}
      </button>
    );
  }

  if (variant === 'floating') {
    return (
      <button
        type="button"
        id="voice-order-btn-floating"
        onClick={onClick}
        disabled={disabled}
        className={`fixed bottom-20 right-4 z-20 flex items-center gap-2 px-4 py-3 rounded-full font-bold shadow-lg transition-all active:scale-95 ${
          isListening
            ? 'bg-rose-600 text-white ring-4 ring-rose-300 animate-pulse'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
        } ${className}`}
        aria-label="Voice Order"
      >
        <Mic className="w-5 h-5" />
        <span className="text-sm font-semibold">Voice Order</span>
      </button>
    );
  }

  // Header / Standard variant
  return (
    <button
      type="button"
      id="voice-order-btn-header"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
        isListening
          ? 'bg-rose-500 text-white animate-pulse shadow-xs ring-2 ring-rose-300'
          : 'bg-gradient-to-r from-indigo-50 to-violet-50 hover:from-indigo-100 hover:to-violet-100 border border-indigo-200 text-indigo-900 shadow-2xs'
      } ${className}`}
      aria-label="Voice Order"
      title={supported ? 'Voice Order (Speak in Hindi or English)' : 'Voice Order (Browser speech recognition)'}
    >
      {isListening ? (
        <Mic className="w-3.5 h-3.5 text-white animate-pulse shrink-0" />
      ) : (
        <Mic className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
      )}
      <span className="truncate">Voice Order</span>
      <span className="text-[10px] px-1 py-0.2 bg-indigo-200/80 text-indigo-900 rounded font-bold uppercase tracking-wider hidden sm:inline">
        Beta
      </span>
    </button>
  );
};
