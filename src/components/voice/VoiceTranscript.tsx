import React from 'react';
import { VoiceState, VoiceLanguage } from '../../services/voice/voiceTypes';
import { Globe, Mic, Radio, Volume2 } from 'lucide-react';

interface VoiceTranscriptProps {
  state: VoiceState;
  interimTranscript: string;
  finalTranscript: string;
  selectedLanguage: VoiceLanguage;
  onLanguageChange: (lang: VoiceLanguage) => void;
}

export const VoiceTranscript: React.FC<VoiceTranscriptProps> = ({
  state,
  interimTranscript,
  finalTranscript,
  selectedLanguage,
  onLanguageChange
}) => {
  const displayTranscript = finalTranscript || interimTranscript;

  const getStateBadge = () => {
    switch (state) {
      case 'LISTENING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping" />
            Listening...
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Radio className="w-3.5 h-3.5 animate-spin" />
            Matching Menu...
          </span>
        );
      case 'MATCHED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            ✓ Items Recognized
          </span>
        );
      case 'NEEDS_CLARIFICATION':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            ⚠️ Clarification Needed
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            Error
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            Ready
          </span>
        );
    }
  };

  return (
    <div className="w-full bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 sm:p-4 space-y-3">
      {/* Top bar: State badge & Language switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {getStateBadge()}
        </div>

        {/* Language selector */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 text-xs">
          <Globe className="w-3.5 h-3.5 text-slate-400 ml-1.5" />
          <button
            type="button"
            onClick={() => onLanguageChange('auto')}
            className={`px-2 py-1 rounded-md font-semibold transition-all ${
              selectedLanguage === 'auto'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => onLanguageChange('hi-IN')}
            className={`px-2 py-1 rounded-md font-semibold transition-all ${
              selectedLanguage === 'hi-IN'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Hindi
          </button>
          <button
            type="button"
            onClick={() => onLanguageChange('en-IN')}
            className={`px-2 py-1 rounded-md font-semibold transition-all ${
              selectedLanguage === 'en-IN'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            English
          </button>
        </div>
      </div>

      {/* Transcript text box */}
      <div className="min-h-[56px] flex flex-col justify-center bg-white border border-slate-200 rounded-xl px-3.5 py-2.5">
        {displayTranscript ? (
          <div className="text-sm sm:text-base text-slate-900 font-medium leading-relaxed break-words">
            <span className="text-xs text-slate-400 uppercase tracking-wider block font-bold mb-0.5">
              Heard:
            </span>
            &ldquo;{finalTranscript || <span className="text-slate-500 italic">{interimTranscript}</span>}&rdquo;
          </div>
        ) : (
          <div className="text-xs sm:text-sm text-slate-400 italic">
            {state === 'LISTENING'
              ? 'Speak naturally (e.g., "Do veg biryani aur ek coke")...'
              : 'Tap the microphone below and say your order...'}
          </div>
        )}
      </div>
    </div>
  );
};
