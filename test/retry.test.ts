import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RateLimitError } from '../src/abstract/errors.js';
import { unwrap } from '../src/http.js';
import {
  parseRateLimit,
  withRetries,
  type RetryInfo,
  type RetryOptions,
} from '../src/retry.js';

// ky waits with setTimeout; fake it so rate-limit waits don't really sleep.
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }));
afterEach(() => vi.useRealTimers());

const now = () => Math.floor(Date.now() / 1000);

/** A fetch that plays back scripted responses (or thrown errors) in order. */
function scripted(...steps: (Response | Error)[]) {
  const requests: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    const step = steps.shift();
    if (!step) throw new Error('no more scripted responses');
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

function setup(steps: (Response | Error)[], options: RetryOptions = {}) {
  const { fetch, requests } = scripted(...steps);
  const retries: RetryInfo[] = [];
  const wrapped = withRetries(fetch, {
    baseDelay: 10,
    timeout: false,
    onRetry: (info) => retries.push(info),
    ...options,
  });
  /** Runs a request, advancing fake time until it settles. */
  const run = async (url = 'https://x.test/a', init?: RequestInit) => {
    const promise = wrapped(url, init);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  };
  return { run, requests, retries };
}

const ok = () => Response.json({ ok: true });
const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers });

describe('withRetries', () => {
  test('429 waits for Retry-After, then succeeds', async () => {
    const { run, retries } = setup([
      json(429, {}, { 'Retry-After': '2' }),
      ok(),
    ]);
    expect((await run()).status).toBe(200);
    expect(retries).toMatchObject([
      { wait: 2000, reason: 'rate limited (429)' },
    ]);
  });

  test("GitHub's primary limit (403, none remaining) waits until reset", async () => {
    const { run, retries } = setup([
      json(
        403,
        { message: 'API rate limit exceeded' },
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(now() + 5),
        },
      ),
      ok(),
    ]);
    expect((await run()).status).toBe(200);
    expect(retries[0].wait).toBeGreaterThan(5000);
    expect(retries[0].wait).toBeLessThanOrEqual(6000);
  });

  test("GitHub's secondary limit without headers waits a minute", async () => {
    const { run, retries } = setup([
      json(403, { message: 'You have exceeded a secondary rate limit.' }),
      ok(),
    ]);
    expect((await run()).status).toBe(200);
    expect(retries.map((r) => r.wait)).toEqual([60_000]);
  });

  test('rate-limited writes are retried, with the body resent', async () => {
    const { run, requests } = setup([
      json(429, {}, { 'Retry-After': '1' }),
      ok(),
    ]);
    await run('https://x.test/a', { method: 'POST', body: '{"title":"x"}' });
    expect(requests).toHaveLength(2);
    expect(await requests[1].text()).toBe('{"title":"x"}');
  });

  test('a 403 that is not a rate limit is returned as is', async () => {
    const { run, retries } = setup([
      json(403, { message: 'Must have admin rights' }),
    ]);
    expect((await run()).status).toBe(403);
    expect(retries).toEqual([]);
  });

  test('server errors on reads back off and retry', async () => {
    const { run, retries } = setup([json(502, {}), json(503, {}), ok()]);
    expect((await run()).status).toBe(200);
    expect(retries.map((r) => r.reason)).toEqual([
      'server error (502)',
      'server error (503)',
    ]);
  });

  test('server errors on writes are not retried', async () => {
    const { run, requests } = setup([json(502, {})]);
    expect(
      (await run('https://x.test/a', { method: 'POST', body: '{}' })).status,
    ).toBe(502);
    expect(requests).toHaveLength(1);
  });

  test('network errors retry reads but not writes', async () => {
    const read = setup([new TypeError('fetch failed'), ok()]);
    expect((await read.run()).status).toBe(200);

    const write = setup([new TypeError('fetch failed'), ok()]);
    await expect(
      write.run('https://x.test/a', { method: 'PATCH', body: '{}' }),
    ).rejects.toThrow();
    expect(write.requests).toHaveLength(1);
  });

  test('gives up after the configured retries', async () => {
    const { run, requests } = setup(
      [json(503, {}), json(503, {}), json(503, {})],
      {
        retries: 2,
      },
    );
    expect((await run()).status).toBe(503);
    expect(requests).toHaveLength(3);
  });

  test('retries: 0 turns retries off', async () => {
    const { run, requests } = setup([json(429, {}, { 'Retry-After': '0' })], {
      retries: 0,
    });
    expect((await run()).status).toBe(429);
    expect(requests).toHaveLength(1);
  });

  test("a limit that won't clear within maxWait becomes a RateLimitError", async () => {
    const reset = now() + 3600;
    const { run, retries } = setup([
      json(
        429,
        { message: 'Retry later' },
        { 'ratelimit-remaining': '0', 'ratelimit-reset': String(reset) },
      ),
    ]);
    const error = await unwrap(
      'gitlab',
      run().then(async (response) => ({
        response,
        error: await response.json(),
      })),
    ).catch((e) => e);

    expect(retries).toEqual([]);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ status: 429, forge: 'gitlab' });
    expect(error.resetAt.getTime()).toBe(reset * 1000);
  });

  test('times out slow requests', async () => {
    const never: typeof fetch = () => new Promise(() => {});
    const wrapped = withRetries(never, { timeout: 50, retries: 0 });
    const promise = wrapped('https://x.test/a');
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  test('reports rate limit headers from either forge', async () => {
    const seen: unknown[] = [];
    const { fetch } = scripted(
      json(
        200,
        {},
        {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '100',
        },
      ),
      json(
        200,
        {},
        {
          'ratelimit-limit': '500',
          'ratelimit-remaining': '499',
          'ratelimit-reset': '200',
        },
      ),
      ok(),
    );
    const wrapped = withRetries(fetch, { timeout: false }, (limit) =>
      seen.push(limit),
    );
    await wrapped('https://x.test/a');
    await wrapped('https://x.test/b');
    await wrapped('https://x.test/c');

    expect(seen).toEqual([
      { limit: 5000, remaining: 4999, reset: new Date(100_000) },
      { limit: 500, remaining: 499, reset: new Date(200_000) },
    ]);
    expect(parseRateLimit(new Headers())).toBeUndefined();
  });
});
