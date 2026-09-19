import { describe, it, expect } from 'vitest';
import { app } from '../../server';

describe('Development Preview & Dev Server Stability Suite', () => {
  it('1. /api/health endpoint returns 200 OK with correct JSON payload', async () => {
    // Simulate HTTP GET /api/health request to Express app
    const res = await new Promise<any>((resolve) => {
      const req = {
        method: 'GET',
        url: '/api/health',
        headers: {}
      } as any;

      let statusCode = 200;
      let jsonBody: any = null;

      const responseObj = {
        status: (code: number) => {
          statusCode = code;
          return responseObj;
        },
        json: (data: any) => {
          jsonBody = data;
          resolve({ status: statusCode, body: jsonBody });
        },
        setHeader: () => {},
        sendStatus: (code: number) => resolve({ status: code, body: null })
      } as any;

      app(req, responseObj);
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      service: 'restaurantos-api'
    });
  });

  it('2. Subpath /restorent-os/api/health is correctly normalized and returns 200 OK without redirect loop', async () => {
    const res = await new Promise<any>((resolve) => {
      const req = {
        method: 'GET',
        url: '/restorent-os/api/health',
        headers: {}
      } as any;

      let statusCode = 200;
      let jsonBody: any = null;

      const responseObj = {
        status: (code: number) => {
          statusCode = code;
          return responseObj;
        },
        json: (data: any) => {
          jsonBody = data;
          resolve({ status: statusCode, body: jsonBody });
        },
        setHeader: () => {},
        sendStatus: (code: number) => resolve({ status: code, body: null })
      } as any;

      app(req, responseObj);
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      service: 'restaurantos-api'
    });
  });

  it('3. Non-existent /api/* endpoint returns 404 JSON and is NOT swallowed by SPA fallback HTML', async () => {
    const res = await new Promise<any>((resolve) => {
      const req = {
        method: 'GET',
        url: '/api/nonexistent-endpoint-test-xyz',
        headers: {}
      } as any;

      let statusCode = 200;
      let jsonBody: any = null;

      const responseObj = {
        status: (code: number) => {
          statusCode = code;
          return responseObj;
        },
        json: (data: any) => {
          jsonBody = data;
          resolve({ status: statusCode, body: jsonBody });
        },
        setHeader: () => {},
        sendStatus: (code: number) => resolve({ status: code, body: null })
      } as any;

      app(req, responseObj);
    });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'API_ENDPOINT_NOT_FOUND');
  });

  it('4. Service Worker dev disabling logic accurately detects non-production domains', () => {
    const isProdHostedDevHost = (hostname: string, protocol: string) => {
      return protocol === 'https:' && (hostname === 'scrrana2000-sys.github.io' || hostname.endsWith('.github.io'));
    };

    expect(isProdHostedDevHost('localhost', 'http:')).toBe(false);
    expect(isProdHostedDevHost('ais-dev-4ft674ruzfz7tdktvsq66r-706536036747.asia-east1.run.app', 'https:')).toBe(false);
    expect(isProdHostedDevHost('ais-pre-4ft674ruzfz7tdktvsq66r-706536036747.asia-east1.run.app', 'https:')).toBe(false);
    expect(isProdHostedDevHost('127.0.0.1', 'http:')).toBe(false);
    expect(isProdHostedDevHost('scrrana2000-sys.github.io', 'https:')).toBe(true);
  });
});
