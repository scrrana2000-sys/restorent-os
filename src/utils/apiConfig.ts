/**
 * Resolves the absolute API endpoint URL based on environment configuration.
 * Supports relative path routing for local/AI Studio development,
 * and external cross-origin base URLs for production environments (e.g. GitHub Pages -> Cloud Run).
 */
export function getApiUrl(endpoint: string): string {
  const cleanPath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;

  const isBrowser = typeof window !== 'undefined';
  
  // Safe environment-independent base URL selection
  let baseUrl = '';
  if (isBrowser) {
    baseUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin;
  } else {
    baseUrl = (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) || 'http://localhost:3000';
  }

  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return `${cleanBaseUrl}/${cleanPath}`;
}
