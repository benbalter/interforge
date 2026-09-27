import createClient from 'openapi-fetch';
import type { paths } from './openapi.js';

/** The GitHub REST API version the generated types describe. */
export const GITHUB_API_VERSION = '2026-03-10';

export type GithubClient = ReturnType<typeof createClient<paths>>;

export function createGithubClient(options: {
  apiUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}): GithubClient {
  return createClient<paths>({
    baseUrl: options.apiUrl,
    fetch: options.fetch,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'forgewright',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
    },
  });
}
