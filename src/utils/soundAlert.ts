/**
 * Web Audio API Sound Alert for RestaurantOS
 * 
 * Synthesizes a soft, clean two-tone chime for operational alerts
 * (e.g. new online orders arriving in KDS / POS).
 * 
 * REQUIREMENTS:
 * 1. Zero external audio dependencies or audio file network requests.
 * 2. Short, pleasant 2-tone frequency chime (~350ms total).
 * 3. Gracefully catches browser autoplay policy rejections without breaking UI.
 * 4. Never loops continuously or creates aggressive noise.
 */

let sharedAudioCtx: AudioContext | null = null;
let soundEnabled = true;

/**
 * Returns a cached AudioContext, or initializes one if supported.
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    try {
      sharedAudioCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * Resets the cached AudioContext instance (primarily used for unit testing).
 */
export function resetAudioContextForTesting(): void {
  sharedAudioCtx = null;
}

/**
 * Checks if sound alert is globally enabled in user settings.
 */
export function isSoundAlertEnabled(): boolean {
  return soundEnabled;
}

/**
 * Toggles or sets sound alert enabled state.
 */
export function setSoundAlertEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

/**
 * Unlock the shared Web Audio context from a real user gesture.
 * Mobile browsers may block autoplay until the page has interacted with the user.
 */
export async function unlockNewOrderSoundAlert(): Promise<boolean> {
  if (typeof window === 'undefined' || !soundEnabled) return false;

  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx.state === 'running';
  } catch (err) {
    console.debug('[RestaurantOS Audio] Could not unlock sound alerts:', err);
    return false;
  }
}

/**
 * Attempts to play a two-tone chime alert.
 * 
 * Gracefully resolves even if the browser blocks audio autoplay.
 * Returns true if playback succeeded, false if blocked or unsupported.
 */
export async function playNewOrderSoundAlert(): Promise<boolean> {
  if (!soundEnabled) return false;

  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    // If AudioContext is suspended (browser autoplay restriction), try to resume
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay policy prevented resuming without prior user gesture
        return false;
      }
    }

    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5) - bright notification lead
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.18);

    // Tone 2: 880.00 Hz (A5) - clear positive resolve chime
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.0, now + 0.12);
    gain2.gain.setValueAtTime(0.001, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.22, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now + 0.12);
    osc2.stop(now + 0.38);

    return true;
  } catch (err) {
    // Gracefully catch any AudioContext or browser restriction errors
    console.debug('[RestaurantOS Audio] Sound alert playback skipped or blocked:', err);
    return false;
  }
}
