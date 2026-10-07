/**
 * HttpClient response-handling tests.
 *
 * Regression: connectwise-automate-mcp#54 (same defect class) — API calls
 * returned an empty object (200 with a non-JSON content-type was swallowed
 * as `{}`), and error paths could throw "Body is unusable: Body has already
 * been read" (the error path consumed the body with response.json() and then
 * re-read it with response.text() in the catch). The body must be read
 * exactly once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, authHeaders } from '../../src/http.js';
import { RateLimiter } from '../../src/rate-limiter.js';
import { resolveConfig } from '../../src/config.js';
import {
  AteraError,
  AteraNotFoundError,
  AteraServerError,
} from '../../src/errors.js';

const config = resolveConfig({ apiKey: 'test-api-key' });

function makeClient(): HttpClient {
  return new HttpClient(config, new RateLimiter(config.rateLimit));
}

/** A real Response so body semantics (one-shot stream) are exercised. */
function realResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('HttpClient response handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a JSON 200 response', async () => {
    vi.mocked(fetch).mockResolvedValue(realResponse('[{"AgentID":1}]'));
    const result = await makeClient().request('/agents');
    expect(result).toEqual([{ AgentID: 1 }]);
  });

  it('parses JSON even when the content-type header is wrong', async () => {
    vi.mocked(fetch).mockResolvedValue(
      realResponse('{"AgentID":7}', { headers: { 'content-type': 'text/plain' } })
    );
    const result = await makeClient().request('/agents/7');
    expect(result).toEqual({ AgentID: 7 });
  });

  it('returns {} for a genuinely empty 200/204 body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      realResponse('', { status: 200, headers: { 'content-type': 'text/plain' } })
    );
    const result = await makeClient().request('/agents/7', { method: 'DELETE' });
    expect(result).toEqual({});
  });

  it('throws a descriptive error (not {}) for a 200 with a non-JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      realResponse('<html>WAF challenge page</html>', {
        headers: { 'content-type': 'text/html' },
      })
    );
    await expect(makeClient().request('/agents')).rejects.toThrow(
      /Expected JSON .* text\/html.*WAF challenge page/
    );
  });

  it('reads a non-JSON error body exactly once — no "Body is unusable"', async () => {
    vi.mocked(fetch).mockResolvedValue(
      realResponse('<html>gateway error</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })
    );
    // Before the fix this could throw TypeError "Body is unusable: Body has
    // already been read" instead of the typed not-found error carrying the
    // real body.
    const err = await makeClient()
      .request('/agents/999')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AteraNotFoundError);
    expect((err as AteraNotFoundError).response).toContain('gateway error');
  });

  it('passes a parsed JSON error body to the typed error', async () => {
    // 5xx retries once, then throws — each attempt must get a fresh Response.
    vi.mocked(fetch).mockImplementation(async () =>
      realResponse('{"Message":"boom"}', { status: 503 })
    );
    const err = await makeClient()
      .request('/agents')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AteraServerError);
    expect((err as AteraServerError).response).toEqual({ Message: 'boom' });
  }, 15000);

  it('generic non-2xx statuses raise AteraError with the raw body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      realResponse('teapot', { status: 418, headers: { 'content-type': 'text/plain' } })
    );
    const err = await makeClient()
      .request('/agents')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AteraError);
    expect((err as AteraError).response).toBe('teapot');
  });
});

/**
 * Unsigned sample with iss=AteraInterop, aud=apiUsers. Not a live credential.
 * Header is base64url of {"alg":"RS256","typ":"JWT"}.
 */
const JWT = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJpc3MiOiJBdGVyYUludGVyb3AiLCJhdWQiOiJhcGlVc2VycyJ9',
  'c2lnbmF0dXJl',
].join('.');

describe('authHeaders', () => {
  it('sends a JWT as Authorization Bearer and omits X-API-KEY', () => {
    const headers = authHeaders(JWT);
    expect(headers).toEqual({ Authorization: `Bearer ${JWT}` });
    expect(headers['X-API-KEY']).toBeUndefined();
  });

  it('strips a pasted Bearer prefix before sending the token', () => {
    expect(authHeaders(`Bearer ${JWT}`)).toEqual({ Authorization: `Bearer ${JWT}` });
    expect(authHeaders(` bearer ${JWT} `)).toEqual({ Authorization: `Bearer ${JWT}` });
  });

  it('sends a legacy key as X-API-KEY only', () => {
    const headers = authHeaders('test-api-key');
    expect(headers).toEqual({ 'X-API-KEY': 'test-api-key' });
    expect(headers['Authorization']).toBeUndefined();
  });

  it('does not treat dotted non-JWTs as Bearer tokens', () => {
    expect(authHeaders('notajwt.with.dots')).toEqual({ 'X-API-KEY': 'notajwt.with.dots' });
    expect(authHeaders('eyJhbGci.only-two')).toEqual({ 'X-API-KEY': 'eyJhbGci.only-two' });
    expect(authHeaders('eyJhbGci..c2ln')).toEqual({ 'X-API-KEY': 'eyJhbGci..c2ln' });
  });
});

describe('HttpClient auth headers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function clientFor(apiKey: string): HttpClient {
    const resolved = resolveConfig({ apiKey });
    return new HttpClient(resolved, new RateLimiter(resolved.rateLimit));
  }

  async function sentHeaders(apiKey: string): Promise<Headers> {
    let seen: Headers | undefined;
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      seen = new Headers(init?.headers);
      return realResponse('[]');
    });
    await clientFor(apiKey).request('/agents');
    if (!seen) {
      throw new Error('fetch was not called');
    }
    return seen;
  }

  it('sends a JWT on Authorization and not X-API-KEY', async () => {
    const headers = await sentHeaders(JWT);
    expect(headers.get('authorization')).toBe(`Bearer ${JWT}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('strips a pasted Bearer prefix on the wire', async () => {
    const headers = await sentHeaders(`Bearer ${JWT}`);
    expect(headers.get('authorization')).toBe(`Bearer ${JWT}`);
    expect(headers.get('x-api-key')).toBeNull();
  });

  it('sends a legacy key on X-API-KEY and not Authorization', async () => {
    const headers = await sentHeaders('test-api-key');
    expect(headers.get('x-api-key')).toBe('test-api-key');
    expect(headers.get('authorization')).toBeNull();
  });
});
