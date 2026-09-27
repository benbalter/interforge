import { GitService, type ProjectRef } from '../../abstract/service.js';
import { unwrap } from '../../http.js';
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
}

export class GithubService extends GitService {
  readonly forge = 'github';
  readonly instanceUrl: string;
  readonly client: GithubClient;

  constructor({
    token,
    instanceUrl = 'https://github.com',
    apiUrl,
    fetch,
  }: GithubServiceOptions = {}) {
    super();
    this.instanceUrl = instanceUrl.replace(/\/$/, '');
    const defaultApiUrl =
      new URL(this.instanceUrl).hostname === 'github.com'
        ? 'https://api.github.com'
        : `${this.instanceUrl}/api/v3`;
    this.client = createGithubClient({
      apiUrl: apiUrl ?? defaultApiUrl,
      token,
      fetch,
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

  async getCurrentUser() {
    const { data } = await unwrap('github', this.client.GET('/user'));
    return { username: data.login, url: data.html_url };
  }
}
