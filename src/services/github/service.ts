import {
  GitService,
  type DryRunOption,
  type ProjectRef,
} from '../../abstract/service.js';
import { unwrap } from '../../http.js';
import type { RetryOptions } from '../../retry.js';
import { createGithubClient, type GithubClient } from './client.js';
import { toProjectData } from './mappers.js';
import { GithubProject } from './project.js';

export interface GithubServiceOptions {
  token?: string;
  /** Web URL of the instance. Defaults to https://github.com. */
  instanceUrl?: string;
  /** Override the API URL (defaults to api.github.com, or <instance>/api/v3 for GHES). */
  apiUrl?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * REST API version to request. Defaults to the version the types are
   * generated from (GITHUB_API_VERSION). GitHub Enterprise Server rejects
   * versions it doesn't know, so older servers may need `2022-11-28`.
   */
  apiVersion?: string;
  /** Retry and rate-limit behavior. `false` turns retries off. */
  retry?: RetryOptions | false;
  /**
   * Skip writes (recording them in `dryRunLog`) while still reading, like
   * ogr's read-only mode. Pass a function to hear about each skipped write.
   */
  dryRun?: DryRunOption;
}

export class GithubService extends GitService {
  readonly forge = 'github';
  readonly instanceUrl: string;
  readonly client: GithubClient;

  constructor({
    token,
    instanceUrl = 'https://github.com',
    apiUrl,
    apiVersion,
    fetch,
    retry,
    dryRun = false,
  }: GithubServiceOptions = {}) {
    super();
    this.dryRun = dryRun;
    this.instanceUrl = instanceUrl.replace(/\/$/, '');
    const defaultApiUrl =
      new URL(this.instanceUrl).hostname === 'github.com'
        ? 'https://api.github.com'
        : `${this.instanceUrl}/api/v3`;
    this.client = createGithubClient({
      apiUrl: apiUrl ?? defaultApiUrl,
      token,
      apiVersion,
      fetch,
      retry,
      onRateLimit: this.observeRateLimit,
    });
  }

  async getProject({ namespace, repo }: ProjectRef) {
    const { data } = await unwrap(
      'github',
      this.client.GET('/repos/{owner}/{repo}', {
        params: { path: { owner: namespace, repo } },
      }),
    );
    return new GithubProject(toProjectData(data), this);
  }

  /** Asks GitHub; checking the rate limit doesn't count against it. */
  async getRateLimitRemaining() {
    const { data } = await unwrap('github', this.client.GET('/rate_limit'));
    return data.resources.core.remaining;
  }

  async getCurrentUser() {
    const { data } = await unwrap('github', this.client.GET('/user'));
    return { username: data.login, url: data.html_url };
  }
}
