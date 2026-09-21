/**
 * Resolve a RestaurantOS API endpoint.
 *
 * Production browsers use the authoritative Cloud Run API unless they are already
 * running on that exact Cloud Run origin. Local development keeps localhost same-origin
 * and may use an explicit VITE_API_BASE_URL override.
 *
 * This is intentionally deterministic: GitHub Pages and Google AI Studio are frontend
 * hosts, so /api/* must never be sent back to their SPA shell (which returns index.html
 * with HTTP 200 instead of JSON).
 */
const PRODUCTION_API_BASE_URL = 'https://restaurantos-xqi52dpwga-el.a.run.app';
const PRODUCTION_API_HOST = new URL(PRODUCTION_API_BASE_URL).hostname;

export function getApiUrl(endpoint: string): string {
  const cleanPath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const isBrowser = typeof window !== 'undefined';

  let baseUrl = '';
  if (isBrowser) {
    const metaEnv = typeof import.meta !== 'undefined' && import.meta ? (import.meta as any).env : undefined;
    const configured = typeof metaEnv?.VITE_API_BASE_URL === 'string' ? metaEnv.VITE_API_BASE_URL.trim() : '';

    const host = window.location.hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const isProductionCloudRun = host === PRODUCTION_API_HOST;

    if (isLocal) {
      // Local development may intentionally point at another local/test API.
      baseUrl = configured || window.location.origin;
    } else if (isProductionCloudRun) {
      // Keep the deployed API same-origin.
      baseUrl = window.location.origin;
    } else {
      // GitHub Pages, AI Studio and every other static/browser host must call the
      // authoritative production API instead of their SPA /api/* fallback.
      baseUrl = PRODUCTION_API_BASE_URL;
    }
  } else {
    const configured = (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL || '').trim();
    baseUrl = configured || 'http://localhost:3000';
  }

  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  return cleanBaseUrl + '/' + cleanPath;
}

export { PRODUCTION_API_BASE_URL };
