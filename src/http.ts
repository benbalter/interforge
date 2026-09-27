import {
  APIError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  type Forge,
} from './abstract/errors.js';
import LinkHeader from 'http-link-header';
import { isRateLimited, rateLimitResetAt } from './retry.js';

interface FetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/**
 * Turns an openapi-fetch result into data or a thrown ForgeError, so service
 * code reads like ordinary awaited calls.
 */
export async function unwrap<R extends FetchResult>(
  forge: Forge,
  request: Promise<R>,
): Promise<{ data: NonNullable<R['data']>; response: Response }> {
  let result: R;
  try {
    result = await request;
  } catch (error) {
    throw new NetworkError(
      `Request to ${forge} failed: ${(error as Error).message}`,
      { cause: error },
    );
  }

  const { data, error, response } = result;
  if (error !== undefined || !response.ok) {
    // GitLab's messages already start with the status ("404 Not Found").
    const detail = errorMessage(error) ?? response.statusText;
    const message = `${detail.startsWith(String(response.status)) ? '' : `${response.status} `}${detail} (${response.url})`;
    const { status, headers } = response;
    if (isRateLimited(status, headers, errorMessage(error) ?? '')) {
      throw new RateLimitError(
        message,
        forge,
        status,
        error,
        rateLimitResetAt(headers),
      );
    }
    const ErrorClass = status === 404 ? NotFoundError : APIError;
    throw new ErrorClass(message, forge, status, error);
  }
  return { data: data as NonNullable<R['data']>, response };
}

function errorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error || undefined;
  if (error && typeof error === 'object') {
    // GitHub: { message }. GitLab: { message } or { error }.
    const { message, error: detail } = error as Record<string, unknown>;
    const value = message ?? detail;
    if (value !== undefined) {
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
  return undefined;
}

/** The URL of the `Link: rel="next"` page, if there is one. */
export function nextPageUrl(response: Response): URL | undefined {
  const link = response.headers.get('link');
  const [next] = link ? LinkHeader.parse(link).rel('next') : [];
  return next ? new URL(next.uri) : undefined;
}

export function hasNextPage(response: Response): boolean {
  return nextPageUrl(response) !== undefined;
}

/**
 * Yields every item of a list endpoint, fetching a page only when the
 * previous one is used up, so stopping early saves requests. Both forges
 * accept `page` and `per_page` and advertise more with `Link: rel="next"`.
 */
export async function* iteratePages<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; response: Response }>,
): AsyncGenerator<T> {
  for (let page = 1; ; page++) {
    const { data, response } = await fetchPage(page);
    yield* data;
    if (!hasNextPage(response)) return;
  }
}

/** Collects up to `limit` items, then stops iterating (and fetching). */
export async function collect<T>(
  items: AsyncIterable<T>,
  limit = Infinity,
): Promise<T[]> {
  const result: T[] = [];
  if (limit <= 0) return result;
  for await (const item of items) {
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

/** Items per request: enough for `limit`, up to both forges' maximum of 100. */
export function pageSizeFor(limit?: number): number {
  return limit === undefined ? 100 : Math.max(1, Math.min(100, limit));
}

/**
 * Decodes a base64 file body (GitHub wraps it in newlines) as UTF-8, with
 * platform built-ins so it runs in browsers and Workers as well as Node.
 */
export function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\s/g, ''));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}
