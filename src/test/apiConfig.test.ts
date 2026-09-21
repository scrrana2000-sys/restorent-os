import { describe, it, expect, vi, afterEach } from 'vitest';
import { getApiUrl, PRODUCTION_API_BASE_URL } from '../utils/apiConfig';

describe('getApiUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes the official AI Studio app to the production Cloud Run API', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'restaurantos01.ai.studio', origin: 'https://restaurantos01.ai.studio' }
    });

    expect(getApiUrl('/api/submit-online-order'))
      .toBe(`${PRODUCTION_API_BASE_URL}/api/submit-online-order`);
  });

  it('routes generic AI Studio hosts to the production Cloud Run API', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'aistudio.google.com', origin: 'https://aistudio.google.com' }
    });

    expect(getApiUrl('/api/submit-online-order'))
      .toBe(`${PRODUCTION_API_BASE_URL}/api/submit-online-order`);
  });

  it('routes GitHub Pages API calls to the production Cloud Run backend', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'scrrana2000-sys.github.io', origin: 'https://scrrana2000-sys.github.io/restorent-os' }
    });

    expect(getApiUrl('/api/submit-online-order'))
      .toBe(`${PRODUCTION_API_BASE_URL}/api/submit-online-order`);
  });

  it('keeps the production Cloud Run deployment same-origin', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'restaurantos-xqi52dpwga-el.a.run.app', origin: 'https://restaurantos-xqi52dpwga-el.a.run.app' }
    });

    expect(getApiUrl('/api/health'))
      .toBe('https://restaurantos-xqi52dpwga-el.a.run.app/api/health');
  });

  it('keeps localhost development same-origin and respects a local override', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'localhost', origin: 'http://localhost:3000' }
    });

    expect(getApiUrl('/api/health'))
      .toBe('http://localhost:3000/api/health');

    vi.stubGlobal('importMetaEnv', { VITE_API_BASE_URL: 'http://localhost:4173' });
  });
});
