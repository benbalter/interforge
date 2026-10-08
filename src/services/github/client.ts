import createClient from 'openapi-fetch';
import { withRetries, type RateLimit, type RetryOptions } from '../../retry.js';
import type { paths } from './openapi.js';

/** The GitHub REST API version the generated types describe. */
export const GITHUB_API_VERSION = '2026-03-10';

export type GithubClient = ReturnType<typeof createClient<paths>>;

export function createGithubClient(options: {
  apiUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  apiVersion?: string;
  /** `false` turns retries off. */
  retry?: RetryOptions | false;
  onRateLimit?: (limit: RateLimit) => void;
}): GithubClient {
  // Look fetch up per call, so test interceptors installed later still apply.
  const base: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return createClient<paths>({
    baseUrl: options.apiUrl,
    fetch: withRetries(
      base,
      options.retry === false ? { retries: 0 } : options.retry,
      options.onRateLimit,
    ),
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'interforge',
      'X-GitHub-Api-Version': options.apiVersion ?? GITHUB_API_VERSION,
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
    },
  });
}
