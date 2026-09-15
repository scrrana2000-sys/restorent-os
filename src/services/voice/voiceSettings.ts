import { VoiceLanguage } from './voiceTypes';

export interface VoiceAssistantSettings {
  enabled: boolean;
  alwaysListening: boolean;
  spokenResponses: boolean;
  language: VoiceLanguage;
  completelyHidden?: boolean;
}

const SETTINGS_KEY = 'restaurantos_voice_settings';
const INTRO_KEY = 'restaurantos_assistant_intro_shown';

const DEFAULT_SETTINGS: VoiceAssistantSettings = {
  enabled: true,
  alwaysListening: false,
  spokenResponses: true,
  language: 'auto',
  completelyHidden: false
};

export function getVoiceAssistantSettings(): VoiceAssistantSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveVoiceAssistantSettings(settings: Partial<VoiceAssistantSettings>): VoiceAssistantSettings {
  const current = getVoiceAssistantSettings();
  const updated = { ...current, ...settings };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } catch {
      // Safe ignore
    }
  }
  return updated;
}

export function isAssistantIntroShown(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(INTRO_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markAssistantIntroShown(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(INTRO_KEY, 'true');
    } catch {
      // Safe ignore
    }
  }
}

export const VOICE_ASSISTANT_TOGGLE_EVENT = 'restaurantos_voice_assistant_toggle';

export function setVoiceAssistantEnabled(enabled: boolean): VoiceAssistantSettings {
  const updated = saveVoiceAssistantSettings({
    enabled,
    ...(enabled ? { completelyHidden: false } : {})
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(VOICE_ASSISTANT_TOGGLE_EVENT, {
        detail: { enabled, completelyHidden: updated.completelyHidden }
      })
    );
  }
  return updated;
}

export function toggleVoiceAssistant(): boolean {
  const current = getVoiceAssistantSettings();
  const isCurrentlyActive = current.enabled && !current.completelyHidden;
  const next = !isCurrentlyActive;
  if (next) {
    setVoiceAssistantEnabled(true);
  } else {
    setVoiceAssistantCompletelyHidden(true);
  }
  return next;
}

export function setVoiceAssistantCompletelyHidden(completelyHidden: boolean): VoiceAssistantSettings {
  const updated = saveVoiceAssistantSettings({ completelyHidden, enabled: !completelyHidden });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(VOICE_ASSISTANT_TOGGLE_EVENT, {
        detail: { enabled: !completelyHidden, completelyHidden }
      })
    );
  }
  return updated;
}


