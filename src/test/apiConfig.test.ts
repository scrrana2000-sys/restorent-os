import { describe, it, expect, vi, afterEach } from 'vitest';
import { getApiUrl, PRODUCTION_API_BASE_URL } from '../utils/apiConfig';

describe('getApiUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps RestaurantOS AI Studio preview API calls same-origin', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'restaurantos01.ai.studio', origin: 'https://restaurantos01.ai.studio' }
    });

    expect(getApiUrl('/api/submit-online-order'))
      .toBe('https://restaurantos01.ai.studio/api/submit-online-order');
  });

  it('uses the trusted production API from the generic AI Studio shell', () => {
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

  it('keeps actual Cloud Run deployments same-origin', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'restaurantos-xqi52dpwga-el.a.run.app', origin: 'https://restaurantos-xqi52dpwga-el.a.run.app' }
    });

    expect(getApiUrl('/api/health'))
      .toBe('https://restaurantos-xqi52dpwga-el.a.run.app/api/health');
  });
});
