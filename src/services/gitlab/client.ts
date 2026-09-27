import createClient from 'openapi-fetch';
import type { paths } from './openapi.js';

export type GitlabClient = ReturnType<typeof createClient<paths>>;

export function createGitlabClient(options: {
  instanceUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}): GitlabClient {
  return createClient<paths>({
    // Paths in GitLab's description already start with /api/v4.
    baseUrl: options.instanceUrl,
    fetch: options.fetch,
    // GitLab takes comma-separated arrays (labels=a,b).
    querySerializer: { array: { style: 'form', explode: false } },
    headers: {
      'User-Agent': 'forgewright',
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
    },
  });
}
