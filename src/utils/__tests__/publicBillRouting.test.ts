import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildPublicBillUrl,
  extractBillParamsFromUrl,
  isPublicBillRoute
} from '../urlUtils';

describe('Public Bill Routing & URL Utilities', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // Reset location mock
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        href: 'https://scrrana2000-sys.github.io/restorent-os/',
        origin: 'https://scrrana2000-sys.github.io',
        pathname: '/restorent-os/',
        search: '',
        hash: '',
        hostname: 'scrrana2000-sys.github.io'
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation
    });
  });

  it('builds a canonical public bill URL with orderId and restaurantId', () => {
    const url = buildPublicBillUrl('ord_999', 'rest_123');
    expect(url).toContain('bill=ord_999');
    expect(url).toContain('rest=rest_123');
  });

  it('detects when not on a public bill route', () => {
    window.location.search = '';
    expect(isPublicBillRoute()).toBe(false);
    expect(extractBillParamsFromUrl()).toBeNull();
  });

  it('extracts bill parameters from search query', () => {
    window.location.search = '?bill=ord_456&rest=rest_789&download=pdf';
    expect(isPublicBillRoute()).toBe(true);

    const params = extractBillParamsFromUrl();
    expect(params).not.toBeNull();
    expect(params?.orderId).toBe('ord_456');
    expect(params?.restaurantId).toBe('rest_789');
    expect(params?.autoDownload).toBe(true);
  });
});
