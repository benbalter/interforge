import createClient from 'openapi-fetch';
import { withRetries, type RateLimit, type RetryOptions } from '../../retry.js';
import type { paths } from './openapi.js';

export type GitlabClient = ReturnType<typeof createClient<paths>>;

export function createGitlabClient(options: {
  instanceUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  /** `false` turns retries off. */
  retry?: RetryOptions | false;
  onRateLimit?: (limit: RateLimit) => void;
}): GitlabClient {
  // Look fetch up per call, so test interceptors installed later still apply.
  const base: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return createClient<paths>({
    // Paths in GitLab's description already start with /api/v4.
    baseUrl: options.instanceUrl,
    fetch: withRetries(
      base,
      options.retry === false ? { retries: 0 } : options.retry,
      options.onRateLimit,
    ),
    // GitLab takes comma-separated arrays (labels=a,b).
    querySerializer: { array: { style: 'form', explode: false } },
    headers: {
      'User-Agent': 'forgewright',
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
    },
  });
}
