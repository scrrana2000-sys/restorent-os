/**
 * Resolve a RestaurantOS API endpoint.
 *
 * Localhost and Cloud Run are same-origin, while GitHub Pages/AI Studio previews
 * are static frontend hosts and therefore must use the trusted production API.
 * VITE_API_BASE_URL remains an optional explicit override.
 */
const PRODUCTION_API_BASE_URL = 'https://restaurantos-xqi52dpwga-el.a.run.app';

export function getApiUrl(endpoint: string): string {
  const cleanPath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const isBrowser = typeof window !== 'undefined';

  let baseUrl = '';
  if (isBrowser) {
    const metaEnv = typeof import.meta !== 'undefined' && import.meta ? (import.meta as any).env : undefined;
    const configured = typeof metaEnv?.VITE_API_BASE_URL === 'string' ? metaEnv.VITE_API_BASE_URL.trim() : '';

    const host = window.location.hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    // Google AI Studio preview runs the RestaurantOS Express + Vite development
    // server on the same preview origin. Keep /api/* same-origin there so checkout,
    // customer tracking, and owner APIs do not depend on a deleted/stale production
    // Cloud Run URL during AI Studio validation.
    // Only non-AI-Studio *.run.app hosts are treated as deployed Cloud Run API hosts.
    const isAiStudioPreview = host.startsWith('ais-dev-');
    const isCloudRun = host.endsWith('.run.app') && !isAiStudioPreview;

    if (configured && (isLocal || !configured.includes('localhost'))) {
      baseUrl = configured;
    } else {
      baseUrl = isLocal || isAiStudioPreview || isCloudRun
        ? window.location.origin
        : PRODUCTION_API_BASE_URL;
    }
  } else {
    const configured = (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL || '').trim();
    baseUrl = configured || 'http://localhost:3000';
  }

  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  return `${cleanBaseUrl}/${cleanPath}`;
}

export { PRODUCTION_API_BASE_URL };
