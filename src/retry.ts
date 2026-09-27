/**
 * Retries, timeouts and rate limits for both forge clients, built on ky.
 *
 * ky handles the generic parts: exponential backoff with jitter, retrying
 * 500/502/503/504 and network errors for GET and HEAD only (writes may have
 * taken effect), and request timeouts.
 *
 * The forge-specific part is custom because ky can't express it:
 * - GitHub signals rate limits with 403 (no requests remaining, or a
 *   "secondary rate limit" message), not only 429.
 * - Rate-limited requests weren't acted on, so they're retried for any
 *   method, after `Retry-After` or the reset time (GitHub asks for at least a
 *   minute after a secondary limit without a header).
 * - A limit that won't clear within `maxWait` fails fast as a RateLimitError
 *   carrying `resetAt`, instead of ky's behavior of capping the wait and
 *   retrying anyway.
 */
import ky, { HTTPError } from 'ky';

export interface RetryOptions {
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** Longest rate-limit wait (ms) worth sleeping through. Default 60 seconds. */
  maxWait?: number;
  /** First backoff delay (ms) for server and network errors. Default 1 second. */
  baseDelay?: number;
  /** Per-attempt timeout (ms), or false for none. Default 30 seconds. */
  timeout?: number | false;
  /** Called before each retry, e.g. for logging. */
  onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  attempt: number;
  /** Known for rate limits; backoff delays are chosen by ky. */
  wait?: number;
  reason: string;
  method: string;
  url: string;
}

export interface RateLimit {
  limit?: number;
  remaining?: number;
  reset?: Date;
}

const TRANSIENT = new Set([500, 502, 503, 504]);
const SECONDARY_LIMIT_WAIT = 60_000;

/**
 * Reads GitHub (`x-ratelimit-*`) or GitLab (`ratelimit-*`) headers. Small
 * enough to own: the one parser on npm for this (ratelimit-header-parser)
 * hasn't been updated since its 0.1.0 release in 2023.
 */
export function parseRateLimit(headers: Headers): RateLimit | undefined {
  const get = (name: string) => {
    const value =
      headers.get(`x-ratelimit-${name}`) ?? headers.get(`ratelimit-${name}`);
    return value === null ? undefined : Number(value);
  };
  const remaining = get('remaining');
  if (remaining === undefined) return undefined;
  const reset = get('reset');
  return {
    limit: get('limit'),
    remaining,
    reset: reset === undefined ? undefined : new Date(reset * 1000),
  };
}

/** When a rate-limited response says to try again, if it says. */
export function rateLimitResetAt(headers: Headers): Date | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const at = Number.isNaN(seconds)
      ? Date.parse(retryAfter)
      : Date.now() + seconds * 1000;
    if (!Number.isNaN(at)) return new Date(at);
  }
  const limit = parseRateLimit(headers);
  return limit?.remaining === 0 ? limit.reset : undefined;
}

/** Whether a response is a rate limit, from its status, headers and body. */
export function isRateLimited(status: number, headers: Headers, body: string) {
  if (status === 429) return true;
  if (status !== 403) return false;
  return (
    parseRateLimit(headers)?.remaining === 0 ||
    headers.has('retry-after') ||
    /rate limit/i.test(body)
  );
}

/** How long to wait before retrying a rate-limited response. */
function rateLimitDelay(headers: Headers, body: string, backoff: number) {
  if (headers.has('retry-after')) {
    const at = rateLimitResetAt(headers);
    if (at) return Math.max(at.getTime() - Date.now(), 0);
  }
  const reset = rateLimitResetAt(headers);
  // Reset times are whole seconds; wait one more to be past it.
  if (reset) return Math.max(reset.getTime() - Date.now(), 0) + 1000;
  return /secondary rate limit/i.test(body) ? SECONDARY_LIMIT_WAIT : backoff;
}

/** A fetch for openapi-fetch that retries, times out and watches rate limits. */
export function withRetries(
  fetch: typeof globalThis.fetch,
  options: RetryOptions = {},
  observe?: (limit: RateLimit) => void,
): typeof globalThis.fetch {
  const {
    retries = 3,
    maxWait = 60_000,
    baseDelay = 1000,
    timeout = 30_000,
    onRetry,
  } = options;

  const client = ky.create({
    fetch,
    timeout,
    // ky only retries responses it throws for. Throw for transient errors,
    // and hand everything else (including exhausted retries) back to
    // openapi-fetch as a plain response.
    throwHttpErrors: (status) => TRANSIENT.has(status),
    retry: {
      limit: retries,
      methods: ['get', 'head'],
      statusCodes: [...TRANSIENT],
      afterStatusCodes: [],
      delay: (attempt) => baseDelay * 2 ** (attempt - 1),
      jitter: true,
    },
    hooks: {
      afterResponse: [
        async ({ request, response, retryCount }) => {
          const limit = parseRateLimit(response.headers);
          if (limit) observe?.(limit);

          const { status, headers } = response;
          const body = status === 403 ? await response.clone().text() : '';
          if (!isRateLimited(status, headers, body) || retryCount >= retries) {
            return;
          }
          const wait = rateLimitDelay(
            headers,
            body,
            baseDelay * 2 ** retryCount,
          );
          if (wait > maxWait) return;

          onRetry?.({
            attempt: retryCount + 1,
            wait,
            reason: `rate limited (${status})`,
            method: request.method,
            url: request.url,
          });
          return ky.retry({ delay: wait, code: 'RATE_LIMIT' });
        },
      ],
      beforeRetry: [
        ({ request, error, retryCount }) => {
          if (error instanceof Error && error.name === 'ForceRetryError')
            return;
          onRetry?.({
            attempt: retryCount,
            reason:
              error instanceof HTTPError
                ? `server error (${error.response.status})`
                : `network error: ${(error as Error).message}`,
            method: request.method,
            url: request.url,
          });
        },
      ],
    },
  });

  return async (input, init) => {
    try {
      return await client(new Request(input, init));
    } catch (error) {
      if (!(error instanceof HTTPError)) throw error;
      // ky has already read the body (into `data`), so rebuild the response
      // for openapi-fetch to parse.
      const { response, data } = error;
      return new Response(
        data === undefined || typeof data === 'string'
          ? (data ?? null)
          : JSON.stringify(data),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    }
  };
}
