/**
 * Authoritative utility functions for resolving public RestaurantOS application URLs.
 *
 * Production Frontend:
 * https://scrrana2000-sys.github.io/restorent-os/
 *
 * All public invitation links, QR codes, and email CTAs must target this canonical URL
 * while preserving the GitHub Pages base path (/restorent-os/).
 */

export const PRODUCTION_PUBLIC_URL = 'https://scrrana2000-sys.github.io/restorent-os/';
export const PRODUCTION_ORIGIN = 'https://scrrana2000-sys.github.io';
export const PRODUCTION_BASE_PATH = '/restorent-os/';

// Retained for backward compatibility alias
export const PUBLIC_APP_URL = PRODUCTION_PUBLIC_URL;

/**
 * Resolves the configured public app base URL including the base path (e.g. /restorent-os/).
 * Always ends with a trailing slash for deterministic URL concatenation.
 */
export function getPublicAppBaseUrl(): string {
  // 1. Explicit environment variable override if provided
  const envUrl = typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_APP_URL
    ? import.meta.env.VITE_PUBLIC_APP_URL
    : typeof process !== 'undefined' && process.env?.PUBLIC_APP_URL
      ? process.env.PUBLIC_APP_URL
      : '';

  if (envUrl) {
    return envUrl.endsWith('/') ? envUrl : `${envUrl}/`;
  }

  // 2. Browser runtime check: if already running on github.io, use window origin + base
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname || '';
    if (hostname.includes('github.io')) {
      const origin = window.location.origin;
      const base = import.meta.env.BASE_URL || PRODUCTION_BASE_PATH;
      const cleanBase = base.startsWith('/') ? base : `/${base}`;
      const normalizedBase = cleanBase.endsWith('/') ? cleanBase : `${cleanBase}/`;
      return `${origin}${normalizedBase}`;
    }
  }

  // 3. Authoritative default: Production GitHub Pages deployment
  return PRODUCTION_PUBLIC_URL;
}

/**
 * Returns the public app origin (e.g. https://scrrana2000-sys.github.io).
 */
export function getPublicAppOrigin(): string {
  const baseUrl = getPublicAppBaseUrl();
  try {
    const parsed = new URL(baseUrl);
    return parsed.origin;
  } catch {
    return PRODUCTION_ORIGIN;
  }
}

/**
 * Builds a full public URL for a given sub-path, preserving the /restorent-os/ base path.
 *
 * Example:
 * buildPublicUrl('login') -> https://scrrana2000-sys.github.io/restorent-os/login
 */
export function buildPublicUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const baseUrl = getPublicAppBaseUrl();
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${cleanPath}`;
}

/**
 * Builds the official canonical invitation acceptance URL with the given token.
 * Preserves the production GitHub Pages base path (/restorent-os/).
 *
 * Example:
 * buildInvitationUrl('inv_tok_123') -> https://scrrana2000-sys.github.io/restorent-os/accept-invitation?token=inv_tok_123
 */
export function buildInvitationUrl(token: string): string {
  const cleanToken = (token || '').trim();
  const baseUrl = getPublicAppBaseUrl();
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}accept-invitation?token=${encodeURIComponent(cleanToken)}`;
}

/**
 * Safely extracts the invitation token from URL search parameters, hash, or pathname.
 * Handles GitHub Pages static routing, hash routing, query string redirects, and direct URLs.
 */
export function extractInvitationTokenFromUrl(): string {
  if (typeof window === 'undefined') return '';

  try {
    // 1. Check window.location.search (standard ?token=xxx)
    const searchParams = new URLSearchParams(window.location.search);
    const searchToken = searchParams.get('token');
    if (searchToken && searchToken.trim()) {
      return searchToken.trim();
    }

    // 2. Check window.location.hash (e.g. #/accept-invitation?token=xxx or #token=xxx)
    if (window.location.hash) {
      const hash = window.location.hash;
      const questionIndex = hash.indexOf('?');
      if (questionIndex !== -1) {
        const hashParams = new URLSearchParams(hash.substring(questionIndex));
        const hashToken = hashParams.get('token');
        if (hashToken && hashToken.trim()) {
          return hashToken.trim();
        }
      }

      // Check regex for token in hash (e.g. #token=xxx or #/token/xxx)
      const tokenMatch = hash.match(/[?&#]token=([^&]+)/i);
      if (tokenMatch && tokenMatch[1]) {
        return decodeURIComponent(tokenMatch[1].trim());
      }
    }

    // 3. Check pathname segment if token is embedded in path
    const pathname = window.location.pathname;
    const pathParts = pathname.split('/');
    const acceptIndex = pathParts.findIndex((p) => p === 'accept-invitation');
    if (acceptIndex !== -1 && pathParts[acceptIndex + 1]) {
      const potentialToken = pathParts[acceptIndex + 1];
      if (potentialToken.startsWith('inv_tok_') || potentialToken.length >= 16) {
        return potentialToken.trim();
      }
    }
  } catch (err) {
    console.warn('[RestaurantOS] Error extracting invitation token from URL:', err);
  }

  return '';
}

/**
 * Checks whether the current window location represents an invitation acceptance route.
 */
export function isInvitationRoute(): boolean {
  if (typeof window === 'undefined') return false;

  const token = extractInvitationTokenFromUrl();
  if (token) return true;

  const pathname = window.location.pathname || '';
  const hash = window.location.hash || '';

  return (
    pathname.includes('accept-invitation') ||
    pathname.endsWith('/accept-invitation') ||
    hash.includes('accept-invitation')
  );
}

/**
 * Builds the canonical public digital invoice / PDF bill URL for a customer.
 */
export function buildPublicBillUrl(orderId: string, restaurantId?: string): string {
  const cleanOrderId = (orderId || '').trim();
  const cleanRestId = (restaurantId || '').trim();
  const baseUrl = getPublicAppBaseUrl();
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  const queryParams = new URLSearchParams();
  queryParams.set('bill', cleanOrderId);
  if (cleanRestId) {
    queryParams.set('rest', cleanRestId);
  }

  return `${normalizedBase}?${queryParams.toString()}`;
}

export interface PublicBillParams {
  orderId: string;
  restaurantId: string;
  autoDownload: boolean;
}

/**
 * Extracts public bill query parameters (bill, rest, download) from window.location.
 */
export function extractBillParamsFromUrl(): PublicBillParams | null {
  if (typeof window === 'undefined') return null;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    let bill = searchParams.get('bill') || searchParams.get('orderId') || searchParams.get('order');
    let rest = searchParams.get('rest') || searchParams.get('restaurantId') || searchParams.get('restaurant');
    const autoDownload = searchParams.get('download') === 'pdf' || searchParams.get('autoDownload') === 'true';

    // Also inspect hash if using hash routing
    if (!bill && window.location.hash) {
      const hash = window.location.hash;
      const questionIndex = hash.indexOf('?');
      if (questionIndex !== -1) {
        const hashParams = new URLSearchParams(hash.substring(questionIndex));
        bill = hashParams.get('bill') || hashParams.get('orderId') || hashParams.get('order');
        if (!rest) {
          rest = hashParams.get('rest') || hashParams.get('restaurantId') || hashParams.get('restaurant');
        }
      }
    }

    if (bill && bill.trim()) {
      return {
        orderId: bill.trim(),
        restaurantId: (rest || '').trim(),
        autoDownload
      };
    }
  } catch (err) {
    console.warn('[RestaurantOS] Error extracting bill params from URL:', err);
  }

  return null;
}

/**
 * Checks whether the current window location is a public bill viewing request.
 */
export function isPublicBillRoute(): boolean {
  return extractBillParamsFromUrl() !== null;
}

/**
 * Checks whether the current window location is an Android Custom Tab authentication flow.
 */
export function isCustomTabAuthRoute(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('auth_mode') === 'custom_tab') return true;

    if (window.location.hash) {
      const hash = window.location.hash;
      const questionIndex = hash.indexOf('?');
      if (questionIndex !== -1) {
        const hashParams = new URLSearchParams(hash.substring(questionIndex));
        if (hashParams.get('auth_mode') === 'custom_tab') return true;
      }
    }
  } catch (err) {
    console.warn('[RestaurantOS] Error checking custom tab auth route:', err);
  }

  return false;
}

/**
 * Checks whether the current window location represents the Owner Central route (/owner, #owner, ?view=owner, ?owner=true).
 */
export function isOwnerCentralRoute(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const pathname = window.location.pathname || '';
    const cleanPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    if (cleanPath.endsWith('/owner') || pathname.includes('/owner/')) {
      return true;
    }

    const searchParams = new URLSearchParams(window.location.search);
    if (
      searchParams.get('view') === 'owner' ||
      searchParams.get('mode') === 'owner' ||
      searchParams.get('owner') === 'true'
    ) {
      return true;
    }

    if (window.location.hash) {
      const hash = window.location.hash.toLowerCase();
      if (
        hash === '#owner' ||
        hash.startsWith('#owner?') ||
        hash.startsWith('#/owner') ||
        hash.includes('view=owner') ||
        hash.includes('mode=owner')
      ) {
        return true;
      }
    }
  } catch (err) {
    console.warn('[RestaurantOS] Error checking owner central route:', err);
  }

  return false;
}

/**
 * Builds the canonical public URL for Owner Central (/owner or #owner).
 */
export function buildOwnerCentralUrl(): string {
  const baseUrl = getPublicAppBaseUrl();
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}#owner`;
}

/**
 * Checks whether the current window location is a public customer discovery route (?view=discover or #discover or ?discover=true or default root).
 */
export function isCustomerDiscoveryRoute(): boolean {
  if (typeof window === 'undefined') return false;

  // Owner central and other explicit public routes take precedence
  if (isOwnerCentralRoute()) return false;
  if (isCustomerRestaurantRoute()) return false;
  if (isPublicBillRoute()) return false;
  if (isInvitationRoute()) return false;
  if (isCustomTabAuthRoute()) return false;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    if (
      searchParams.get('view') === 'discover' ||
      searchParams.get('mode') === 'customer' ||
      searchParams.get('discover') === 'true'
    ) {
      return true;
    }

    if (window.location.hash) {
      const hash = window.location.hash.toLowerCase();
      if (
        hash.includes('discover') ||
        hash.includes('view=discover') ||
        hash.includes('mode=customer')
      ) {
        return true;
      }
      // If hash exists and is something else (not discover), return false
      if (hash && hash !== '#' && !hash.startsWith('#discover')) {
        return false;
      }
    }

    // Default root path is the Customer Front Door
    return true;
  } catch (err) {
    console.warn('[RestaurantOS] Error checking customer discovery route:', err);
  }

  return true;
}

export interface PublicRestaurantRouteParams {
  slug?: string;
  code?: string;
  isMenu?: boolean;
}

/**
 * Builds the canonical public restaurant profile or menu URL.
 * Preserves GitHub Pages compatibility through hash routing or path routing.
 *
 * Example:
 * buildPublicRestaurantUrl('sharma-sweets-raichur') -> https://scrrana2000-sys.github.io/restorent-os/#r/sharma-sweets-raichur
 * buildPublicRestaurantUrl('sharma-sweets-raichur', true) -> https://scrrana2000-sys.github.io/restorent-os/#r/sharma-sweets-raichur/menu
 */
export function buildPublicRestaurantUrl(slugOrCode: string, isMenu: boolean = false): string {
  const cleanId = (slugOrCode || '').trim();
  const baseUrl = getPublicAppBaseUrl();
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const suffix = isMenu ? '/menu' : '';
  return `${normalizedBase}#r/${encodeURIComponent(cleanId)}${suffix}`;
}

/**
 * Safely extracts restaurant identifier (slug or code) and menu intent from URL path, hash, or query parameters.
 */
export function extractRestaurantIdentifierFromUrl(): PublicRestaurantRouteParams | null {
  if (typeof window === 'undefined') return null;

  try {
    // 1. Check Search Parameters (?r=xxx or ?slug=xxx or ?code=xxx or ?restaurant=xxx)
    const searchParams = new URLSearchParams(window.location.search);
    const querySlug = searchParams.get('r') || searchParams.get('slug') || searchParams.get('restaurant');
    const queryCode = searchParams.get('code');
    const isMenuQuery = searchParams.get('menu') === 'true' || searchParams.get('view') === 'menu';

    if (querySlug && querySlug.trim()) {
      const trimmed = querySlug.trim();
      if (trimmed.startsWith('R-') || trimmed.startsWith('r-') || trimmed.startsWith('ROS-') || trimmed.startsWith('ros-')) {
        return {
          code: trimmed.toUpperCase(),
          isMenu: isMenuQuery
        };
      }
      return {
        slug: trimmed,
        isMenu: isMenuQuery
      };
    }

    if (queryCode && queryCode.trim()) {
      return {
        code: queryCode.trim().toUpperCase(),
        isMenu: isMenuQuery
      };
    }

    // 2. Check Hash Route (e.g. #r/slug, #/r/slug, #r/slug/menu, #code=R-0YG9I)
    if (window.location.hash) {
      const hash = window.location.hash;
      const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;

      // Handle hash query params like #r=slug or #?r=slug
      if (cleanHash.includes('=')) {
        const queryStart = cleanHash.indexOf('?');
        const hashQueryStr = queryStart !== -1 ? cleanHash.slice(queryStart + 1) : cleanHash;
        const hashParams = new URLSearchParams(hashQueryStr);
        const hashSlug = hashParams.get('r') || hashParams.get('slug') || hashParams.get('restaurant');
        const hashCode = hashParams.get('code');
        const hashMenu = hashParams.get('menu') === 'true' || hashParams.get('view') === 'menu';

        if (hashSlug && hashSlug.trim()) {
          return { slug: hashSlug.trim(), isMenu: hashMenu };
        }
        if (hashCode && hashCode.trim()) {
          return { code: hashCode.trim().toUpperCase(), isMenu: hashMenu };
        }
      }

      // Handle route patterns like #r/slug or #/r/slug/menu or #restaurant/slug
      const normalizedPath = cleanHash.startsWith('/') ? cleanHash.slice(1) : cleanHash;
      const parts = normalizedPath.split('/').filter(Boolean);

      if (parts[0] === 'r' || parts[0] === 'restaurant') {
        const identifier = parts[1];
        const isMenu = parts[2] === 'menu';
        if (identifier && identifier.trim()) {
          const trimmed = identifier.trim();
          if (trimmed.startsWith('R-') || trimmed.startsWith('r-')) {
            return { code: trimmed.toUpperCase(), isMenu };
          }
          return { slug: trimmed, isMenu };
        }
      }
    }

    // 3. Check Pathname (e.g. /r/:slug or /restorent-os/r/:slug)
    const pathname = window.location.pathname || '';
    const pathParts = pathname.split('/').filter(Boolean);
    const rIndex = pathParts.findIndex((p) => p === 'r' || p === 'restaurant');

    if (rIndex !== -1 && pathParts[rIndex + 1]) {
      const identifier = pathParts[rIndex + 1].trim();
      const isMenu = pathParts[rIndex + 2] === 'menu';
      if (identifier) {
        if (identifier.startsWith('R-') || identifier.startsWith('r-')) {
          return { code: identifier.toUpperCase(), isMenu };
        }
        return { slug: identifier, isMenu };
      }
    }
  } catch (err) {
    console.warn('[RestaurantOS] Error extracting restaurant identifier from URL:', err);
  }

  return null;
}

/**
 * Checks whether the current window location represents a customer restaurant profile route.
 */
export function isCustomerRestaurantRoute(): boolean {
  return extractRestaurantIdentifierFromUrl() !== null;
}


