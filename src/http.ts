import {
  APIError,
  NetworkError,
  NotFoundError,
  type Forge,
} from './abstract/errors.js';

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
    const ErrorClass = response.status === 404 ? NotFoundError : APIError;
    throw new ErrorClass(message, forge, response.status, error);
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

export function hasNextPage(response: Response): boolean {
  return /rel="next"/.test(response.headers.get('link') ?? '');
}

/**
 * Collects every page of a list endpoint. Both forges accept `page` and
 * `per_page` and advertise more results with `Link: rel="next"`.
 */
export async function collectPages<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; response: Response }>,
  maxPages = 100,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, response } = await fetchPage(page);
    items.push(...data);
    if (!hasNextPage(response)) break;
  }
  return items;
}
