/**
 * Resolve a RestaurantOS API endpoint.
 *
 * Localhost and Cloud Run are same-origin, while GitHub Pages/AI Studio previews
 * are static frontend hosts and therefore must use the trusted production API.
 * VITE_API_BASE_URL remains an optional explicit override.
 */
const PRODUCTION_API_BASE_URL = 'https://restaurantos-xqi52dpwgo-as.a.run.app';

export function getApiUrl(endpoint: string): string {
  const cleanPath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const isBrowser = typeof window !== 'undefined';

  let baseUrl = '';
  if (isBrowser) {
    const metaEnv = typeof import.meta !== 'undefined' && import.meta ? (import.meta as any).env : undefined;
    const configured = typeof metaEnv?.VITE_API_BASE_URL === 'string' ? metaEnv.VITE_API_BASE_URL.trim() : '';

    const host = window.location.hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    // Only actual Cloud Run hosts are treated as same-origin API hosts.\n    // AI Studio preview hosts also use *.google.com / *.googleusercontent.com, but\n    // their preview shell is not the RestaurantOS API and can return index.html for\n    // /api/* requests (causing JSON parse errors such as "Unexpected token '<'").\n    const isCloudRun = host.endsWith('.run.app');

    if (configured && (isLocal || !configured.includes('localhost'))) {
      baseUrl = configured;
    } else {
      baseUrl = isLocal ? window.location.origin : (isCloudRun ? window.location.origin : PRODUCTION_API_BASE_URL);
    }
  } else {
    const configured = (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL || '').trim();
    baseUrl = configured || 'http://localhost:3000';
  }

  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  return `${cleanBaseUrl}/${cleanPath}`;
}

export { PRODUCTION_API_BASE_URL };
