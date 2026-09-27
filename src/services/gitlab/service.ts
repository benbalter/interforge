import { ForgeError } from '../../abstract/errors.js';
import { GitService, type ProjectRef } from '../../abstract/service.js';
import { unwrap } from '../../http.js';
import { createGitlabClient, type GitlabClient } from './client.js';
import { toProjectData } from './mappers.js';
import { GitlabProject } from './project.js';

export interface GitlabServiceOptions {
  token?: string;
  /** Defaults to https://gitlab.com. */
  instanceUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class GitlabService extends GitService {
  readonly forge = 'gitlab';
  readonly instanceUrl: string;
  readonly client: GitlabClient;
  private userIds = new Map<string, number>();

  constructor({
    token,
    instanceUrl = 'https://gitlab.com',
    fetch,
  }: GitlabServiceOptions = {}) {
    super();
    this.instanceUrl = instanceUrl.replace(/\/$/, '');
    this.client = createGitlabClient({
      instanceUrl: this.instanceUrl,
      token,
      fetch,
    });
  }

  async getProject({ namespace, repo }: ProjectRef) {
    const { data } = await unwrap(
      'gitlab',
      this.client.GET('/api/v4/projects/{id}', {
        params: { path: { id: `${namespace}/${repo}` } },
      }),
    );
    return new GitlabProject(toProjectData(data), this);
  }

  async getCurrentUser() {
    const { data } = await unwrap('gitlab', this.client.GET('/api/v4/user'));
    return { username: data.username, url: data.web_url };
  }

  /** GitLab assigns by user ID. Looks up (and caches) IDs for usernames. */
  async getUserIds(usernames: string[]): Promise<number[]> {
    return Promise.all(
      usernames.map(async (username) => {
        const cached = this.userIds.get(username);
        if (cached !== undefined) return cached;

        const { data } = await unwrap(
          'gitlab',
          this.client.GET('/api/v4/users', { params: { query: { username } } }),
        );
        const user = data.find((u) => u.username === username);
        if (!user) throw new ForgeError(`GitLab user not found: ${username}`);
        this.userIds.set(username, user.id);
        return user.id;
      }),
    );
  }
}
