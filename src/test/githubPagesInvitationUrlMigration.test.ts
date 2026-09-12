import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PRODUCTION_PUBLIC_URL,
  PRODUCTION_ORIGIN,
  PRODUCTION_BASE_PATH,
  getPublicAppBaseUrl,
  getPublicAppOrigin,
  buildInvitationUrl,
  buildPublicUrl,
  extractInvitationTokenFromUrl,
  isInvitationRoute
} from '../utils/urlUtils';

describe('GitHub Pages Production Invitation URL Migration Suite', () => {
  describe('1. Canonical Production Constants & URL Resolution', () => {
    it('defines the canonical production GitHub Pages URL', () => {
      expect(PRODUCTION_PUBLIC_URL).toBe('https://scrrana2000-sys.github.io/restorent-os/');
      expect(PRODUCTION_ORIGIN).toBe('https://scrrana2000-sys.github.io');
      expect(PRODUCTION_BASE_PATH).toBe('/restorent-os/');
    });

    it('returns the canonical production base URL by default', () => {
      const baseUrl = getPublicAppBaseUrl();
      expect(baseUrl).toBe('https://scrrana2000-sys.github.io/restorent-os/');
    });

    it('returns the canonical production origin by default', () => {
      const origin = getPublicAppOrigin();
      expect(origin).toBe('https://scrrana2000-sys.github.io');
    });

    it('builds an invitation URL pointing to the production GitHub Pages base path', () => {
      const token = 'inv_tok_test_abc123';
      const url = buildInvitationUrl(token);
      expect(url).toBe('https://scrrana2000-sys.github.io/restorent-os/accept-invitation?token=inv_tok_test_abc123');
      expect(url).not.toContain('localhost');
      expect(url).not.toContain('aistudio.google.com');
      expect(url).not.toContain('.run.app');
    });

    it('builds a public URL with the /restorent-os/ base path for sub-routes', () => {
      const loginUrl = buildPublicUrl('login?email=test%40example.com');
      expect(loginUrl).toBe('https://scrrana2000-sys.github.io/restorent-os/login?email=test%40example.com');
    });

    it('handles leading slashes gracefully in buildPublicUrl', () => {
      const urlWithSlash = buildPublicUrl('/accept-invitation?token=123');
      expect(urlWithSlash).toBe('https://scrrana2000-sys.github.io/restorent-os/accept-invitation?token=123');
    });
  });

  describe('2. Robust Token Extraction Across GitHub Pages Routing Scenarios', () => {
    const originalWindow = global.window;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('extracts token from standard URL search query (?token=xyz)', () => {
      // Mock window.location
      const mockLocation = {
        search: '?token=inv_tok_query_param_999',
        hash: '',
        pathname: '/restorent-os/accept-invitation',
        hostname: 'scrrana2000-sys.github.io',
        origin: 'https://scrrana2000-sys.github.io'
      };
      vi.stubGlobal('window', { location: mockLocation });

      expect(extractInvitationTokenFromUrl()).toBe('inv_tok_query_param_999');
      expect(isInvitationRoute()).toBe(true);
    });

    it('extracts token from hash query parameter (#/accept-invitation?token=xyz)', () => {
      const mockLocation = {
        search: '',
        hash: '#/accept-invitation?token=inv_tok_hash_param_888',
        pathname: '/restorent-os/',
        hostname: 'scrrana2000-sys.github.io',
        origin: 'https://scrrana2000-sys.github.io'
      };
      vi.stubGlobal('window', { location: mockLocation });

      expect(extractInvitationTokenFromUrl()).toBe('inv_tok_hash_param_888');
      expect(isInvitationRoute()).toBe(true);
    });

    it('extracts token from simple hash fragment (#token=xyz)', () => {
      const mockLocation = {
        search: '',
        hash: '#token=inv_tok_simple_hash_777',
        pathname: '/restorent-os/',
        hostname: 'scrrana2000-sys.github.io',
        origin: 'https://scrrana2000-sys.github.io'
      };
      vi.stubGlobal('window', { location: mockLocation });

      expect(extractInvitationTokenFromUrl()).toBe('inv_tok_simple_hash_777');
      expect(isInvitationRoute()).toBe(true);
    });

    it('detects invitation route when pathname contains accept-invitation even without token', () => {
      const mockLocation = {
        search: '',
        hash: '',
        pathname: '/restorent-os/accept-invitation',
        hostname: 'scrrana2000-sys.github.io',
        origin: 'https://scrrana2000-sys.github.io'
      };
      vi.stubGlobal('window', { location: mockLocation });

      expect(isInvitationRoute()).toBe(true);
      expect(extractInvitationTokenFromUrl()).toBe('');
    });

    it('returns false for standard POS and Admin routes', () => {
      const mockLocation = {
        search: '',
        hash: '',
        pathname: '/restorent-os/',
        hostname: 'scrrana2000-sys.github.io',
        origin: 'https://scrrana2000-sys.github.io'
      };
      vi.stubGlobal('window', { location: mockLocation });

      expect(isInvitationRoute()).toBe(false);
      expect(extractInvitationTokenFromUrl()).toBe('');
    });
  });
});
