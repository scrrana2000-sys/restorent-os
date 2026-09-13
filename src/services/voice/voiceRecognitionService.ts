import {
  VoiceState,
  VoiceLanguage,
  VoiceRecognitionError,
  VoiceRecognitionCallbacks
} from './voiceTypes';
import { isVoiceRecognitionSupported, getSpeechRecognitionConstructor } from './voiceSupport';

export class VoiceRecognitionService {
  private recognition: any | null = null;
  private currentState: VoiceState = 'IDLE';
  private callbacks: VoiceRecognitionCallbacks = {};
  private currentLanguage: VoiceLanguage = 'auto';
  private interimTranscript: string = '';
  private finalTranscript: string = '';
  private isExplicitStop: boolean = false;

  constructor(callbacks?: VoiceRecognitionCallbacks) {
    if (callbacks) {
      this.callbacks = callbacks;
    }
  }

  public setCallbacks(callbacks: VoiceRecognitionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public getState(): VoiceState {
    return this.currentState;
  }

  private setState(state: VoiceState): void {
    this.currentState = state;
    this.callbacks.onStateChange?.(state);
  }

  /**
   * Resolves appropriate BCP 47 language tag based on user selection.
   */
  private resolveLanguageCode(lang: VoiceLanguage): string {
    switch (lang) {
      case 'hi-IN':
        return 'hi-IN';
      case 'en-IN':
        return 'en-IN';
      case 'en-US':
        return 'en-US';
      case 'auto':
      default:
        // Indian English default with high tolerance for Hindi loanwords on Android / Chrome
        return 'en-IN';
    }
  }

  /**
   * Starts native speech recognition.
   */
  public async startListening(language: VoiceLanguage = 'auto'): Promise<boolean> {
    if (!isVoiceRecognitionSupported()) {
      const error: VoiceRecognitionError = {
        code: 'NOT_SUPPORTED',
        message: 'Voice ordering is not supported in this browser. Please use Chrome, Edge, or an Android browser.'
      };
      this.setState('ERROR');
      this.callbacks.onError?.(error);
      return false;
    }

    // Stop any existing session
    this.cancelListening();

    const RecognitionClass = getSpeechRecognitionConstructor();
    if (!RecognitionClass) {
      this.setState('ERROR');
      this.callbacks.onError?.({
        code: 'NOT_SUPPORTED',
        message: 'Speech Recognition interface is unavailable.'
      });
      return false;
    }

    try {
      this.currentLanguage = language;
      this.interimTranscript = '';
      this.finalTranscript = '';
      this.isExplicitStop = false;

      this.recognition = new RecognitionClass();
      this.recognition.continuous = false; // Single utterance / command by default
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 3;
      this.recognition.lang = this.resolveLanguageCode(language);

      this.recognition.onstart = () => {
        this.setState('LISTENING');
      };

      this.recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptSegment = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            final += transcriptSegment;
          } else {
            interim += transcriptSegment;
          }
        }

        if (interim) {
          this.interimTranscript = interim;
          this.callbacks.onInterimTranscript?.(interim);
        }

        if (final) {
          this.finalTranscript = final;
          this.setState('PROCESSING');
          this.callbacks.onFinalTranscript?.(final);
        }
      };

      this.recognition.onerror = (event: any) => {
        const browserError = event.error;
        let mappedError: VoiceRecognitionError;

        switch (browserError) {
          case 'not-allowed':
          case 'permission-denied':
            mappedError = {
              code: 'PERMISSION_DENIED',
              message: 'Microphone access is blocked. Allow microphone access in your browser/site settings to use Voice Ordering.',
              technicalDetails: 'Open browser Site Settings → Microphone → Allow'
            };
            break;
          case 'audio-capture':
            mappedError = {
              code: 'MICROPHONE_UNAVAILABLE',
              message: 'Microphone not detected or unavailable.',
              technicalDetails: browserError
            };
            break;
          case 'no-speech':
            mappedError = {
              code: 'NO_SPEECH',
              message: 'No speech detected. Please tap the microphone and speak again.',
              technicalDetails: browserError
            };
            break;
          case 'network':
            mappedError = {
              code: 'NETWORK_ERROR',
              message: 'Speech recognition network error. Please verify your connection or use the menu.',
              technicalDetails: browserError
            };
            break;
          case 'aborted':
            if (this.isExplicitStop) {
              return; // Intentional user cancellation
            }
            mappedError = {
              code: 'ABORTED',
              message: 'Speech recognition was stopped.',
              technicalDetails: browserError
            };
            break;
          default:
            mappedError = {
              code: 'SERVICE_ERROR',
              message: `Speech recognition error: ${browserError || 'Unknown issue'}.`,
              technicalDetails: browserError
            };
            break;
        }

        this.setState('ERROR');
        this.callbacks.onError?.(mappedError);
      };

      this.recognition.onend = () => {
        if (this.currentState === 'LISTENING') {
          // If ended without explicit final transcript or error
          if (!this.finalTranscript && this.interimTranscript) {
            this.finalTranscript = this.interimTranscript;
            this.setState('PROCESSING');
            this.callbacks.onFinalTranscript?.(this.finalTranscript);
          } else if (!this.finalTranscript) {
            this.setState('IDLE');
          }
        }
        this.callbacks.onEnd?.();
      };

      this.recognition.start();
      return true;
    } catch (err: any) {
      console.warn('[RestaurantOS Voice] Failed to start recognition:', err);
      this.setState('ERROR');
      this.callbacks.onError?.({
        code: 'UNKNOWN_ERROR',
        message: err?.message || 'Failed to initialize microphone.',
        technicalDetails: String(err)
      });
      return false;
    }
  }

  /**
   * Stops listening gracefully, waiting for final transcript.
   */
  public stopListening(): void {
    this.isExplicitStop = true;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Safe ignore
      }
    }
  }

  /**
   * Cancels recognition immediately without processing pending audio.
   */
  public cancelListening(): void {
    this.isExplicitStop = true;
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        // Safe ignore
      }
      this.recognition = null;
    }
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.setState('IDLE');
  }
}

export const defaultVoiceService = new VoiceRecognitionService();
