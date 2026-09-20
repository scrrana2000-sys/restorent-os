import { describe, it, expect, vi, afterEach } from 'vitest';
import { getApiUrl, PRODUCTION_API_BASE_URL } from '../utils/apiConfig';

describe('getApiUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the trusted production API from an AI Studio preview host', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'aistudio.google.com', origin: 'https://aistudio.google.com' }
    });

    expect(getApiUrl('/api/submit-online-order'))
      .toBe(`${PRODUCTION_API_BASE_URL}/api/submit-online-order`);
  });

  it('keeps actual Cloud Run deployments same-origin', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'restaurantos-xqi52dpwgo-as.a.run.app', origin: 'https://restaurantos-xqi52dpwgo-as.a.run.app' }
    });

    expect(getApiUrl('/api/health'))
      .toBe('https://restaurantos-xqi52dpwgo-as.a.run.app/api/health');
  });
});
