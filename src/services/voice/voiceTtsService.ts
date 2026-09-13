import { VoiceLanguage } from './voiceTypes';

export interface VoiceTtsOptions {
  enabled?: boolean;
  rate?: number;
  pitch?: number;
}

class VoiceTtsService {
  private synth: SpeechSynthesis | null = null;
  private isEnabled: boolean = true;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  public isSupported(): boolean {
    return this.synth !== null;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }

  public stop(): void {
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch {
        // Safe ignore
      }
    }
  }

  /**
   * Speaks assistant response using native browser SpeechSynthesis API.
   * Safe fallback if TTS is disabled or unsupported.
   */
  public speak(
    text: string,
    language: VoiceLanguage = 'auto',
    options?: VoiceTtsOptions
  ): void {
    if (!this.synth || !this.isEnabled || (options?.enabled === false)) {
      return;
    }

    try {
      this.stop(); // Cancel ongoing speech

      // Strip emojis and clean text for speech
      const cleanedText = text
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .trim();

      if (!cleanedText) return;

      const utterance = new SpeechSynthesisUtterance(cleanedText);
      utterance.rate = options?.rate || 0.95; // Slightly slower for crisp clarity
      utterance.pitch = options?.pitch || 1.05; // Slightly friendly pitch

      // Select voice based on language
      const voices = this.synth.getVoices();
      let targetLang = 'en-IN';
      if (language === 'hi-IN' || /[\u0900-\u097F]/.test(cleanedText)) {
        targetLang = 'hi-IN';
      } else if (language === 'en-US') {
        targetLang = 'en-US';
      }

      const matchingVoice = voices.find(
        (v) => v.lang.toLowerCase().replace('_', '-') === targetLang.toLowerCase()
      ) || voices.find((v) => v.lang.startsWith(targetLang.split('-')[0]));

      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }
      utterance.lang = targetLang;

      this.synth.speak(utterance);
    } catch (err) {
      console.warn('[RestaurantOS Voice TTS] SpeechSynthesis error:', err);
    }
  }
}

export const defaultVoiceTtsService = new VoiceTtsService();
