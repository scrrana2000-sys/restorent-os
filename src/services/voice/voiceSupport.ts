/**
 * Voice Recognition Support & Environment Detection
 * 
 * Checks for browser and platform support of the native Web Speech API
 * (SpeechRecognition or webkitSpeechRecognition) without external paid APIs.
 */

export type MicrophonePermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

export interface VoiceSupportInfo {
  isSupported: boolean;
  engine: 'standard' | 'webkit' | 'none';
  hasMicrophoneAccess: boolean | null; // null if unprompted
  platformDetails: string;
  permissionState?: MicrophonePermissionState;
}

/**
  * Checks current microphone permission state via navigator.permissions API if available.
  */
export async function checkMicrophonePermission(): Promise<MicrophonePermissionState> {
  if (typeof navigator === 'undefined') return 'unknown';

  if (navigator.permissions && typeof navigator.permissions.query === 'function') {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (status && status.state) {
        return status.state as MicrophonePermissionState;
      }
    } catch {
      // Permission API name 'microphone' may be unsupported in Firefox/Safari
    }
  }

  return 'unknown';
}

/**
  * Requests microphone access via mediaDevices.getUserMedia where supported.
  */
export async function requestMicrophonePermission(): Promise<{
  granted: boolean;
  state: MicrophonePermissionState;
  error?: string;
}> {
  if (typeof navigator === 'undefined') {
    return { granted: false, state: 'unknown' };
  }

  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release tracks immediately after permission check
      stream.getTracks().forEach((track) => track.stop());
      return { granted: true, state: 'granted' };
    } catch (err: any) {
      const errName = err?.name || '';
      let state: MicrophonePermissionState = 'denied';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        state = 'denied';
      } else {
        state = await checkMicrophonePermission();
      }
      return {
        granted: false,
        state,
        error: err?.message || 'Microphone access denied.'
      };
    }
  }

  const state = await checkMicrophonePermission();
  return { granted: state === 'granted', state };
}

/**
 * Checks if the current browser/device environment supports native speech recognition.
 */
export function isVoiceRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

/**
 * Gets detailed diagnostic support info for the client environment.
 */
export function getVoiceSupportInfo(): VoiceSupportInfo {
  if (typeof window === 'undefined') {
    return {
      isSupported: false,
      engine: 'none',
      hasMicrophoneAccess: null,
      platformDetails: 'Server / Non-browser environment'
    };
  }

  const hasStandard = !!(window as any).SpeechRecognition;
  const hasWebkit = !!(window as any).webkitSpeechRecognition;

  return {
    isSupported: hasStandard || hasWebkit,
    engine: hasStandard ? 'standard' : hasWebkit ? 'webkit' : 'none',
    hasMicrophoneAccess: null,
    platformDetails: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
  };
}

/**
 * Returns the browser's native SpeechRecognition constructor if available.
 */
export function getSpeechRecognitionConstructor(): any | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
}
