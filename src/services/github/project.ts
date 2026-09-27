import type { CommitFlagOptions } from '../../abstract/commit-flag.js';
import {
  ForgeError,
  IssueTrackerDisabled,
  OperationNotSupported,
} from '../../abstract/errors.js';
import {
  GitProject,
  type CreateIssueOptions,
  type IssueListOptions,
} from '../../abstract/project.js';
import type { CommitStatus, PRStatus } from '../../abstract/status.js';
import { collectPages, decodeBase64, unwrap } from '../../http.js';
import { GithubIssue } from './issue.js';
import {
  toCommitFlag,
  toGithubState,
  toIssueData,
  toProjectData,
  toPullRequestData,
} from './mappers.js';
import { GithubPullRequest } from './pull-request.js';
import type { GithubService } from './service.js';

export class GithubProject extends GitProject {
  declare readonly service: GithubService;

  get client() {
    return this.service.client;
  }

  private get path() {
    return { owner: this.namespace, repo: this.repo };
  }

  private assertIssues() {
    if (!this.hasIssues) throw new IssueTrackerDisabled(this.fullRepoName);
  }

  async getIssueList({
    status = 'open',
    author,
    assignee,
    labels,
  }: IssueListOptions = {}) {
    this.assertIssues();
    const items = await collectPages((page) =>
      unwrap(
        'github',
        this.client.GET('/repos/{owner}/{repo}/issues', {
          params: {
            path: this.path,
            query: {
              state: status,
              creator: author,
              assignee,
              labels: labels?.join(','),
              per_page: 100,
              page,
            },
          },
        }),
      ),
    );
    // GitHub lists pull requests as issues too.
    return items
      .filter((item) => !item.pull_request)
      .map((item) => new GithubIssue(toIssueData(item), this));
  }

  async getIssue(id: number) {
    this.assertIssues();
    const { data } = await unwrap(
      'github',
      this.client.GET('/repos/{owner}/{repo}/issues/{issue_number}', {
        params: { path: { ...this.path, issue_number: id } },
      }),
    );
    if (data.pull_request) {
      throw new OperationNotSupported(`#${id} is a pull request, not an issue`);
    }
    return new GithubIssue(toIssueData(data), this);
  }

  async createIssue(
    title: string,
    body: string,
    { labels, assignees, private: confidential }: CreateIssueOptions = {},
  ) {
    this.assertIssues();
    if (confidential) {
      throw new OperationNotSupported('GitHub has no private issues');
    }
    const { data } = await unwrap(
      'github',
      this.client.POST('/repos/{owner}/{repo}/issues', {
        params: { path: this.path },
        body: { title, body, labels, assignees },
      }),
    );
    return new GithubIssue(toIssueData(data), this);
  }

  async getPrList({ status = 'open' }: { status?: PRStatus } = {}) {
    const state = status === 'merged' ? 'closed' : status;
    const items = await collectPages((page) =>
      unwrap(
        'github',
        this.client.GET('/repos/{owner}/{repo}/pulls', {
          params: { path: this.path, query: { state, per_page: 100, page } },
        }),
      ),
    );
    return items
      .map((item) => new GithubPullRequest(toPullRequestData(item), this))
      .filter((pr) => status !== 'merged' || pr.status === 'merged');
  }

  async getPr(id: number) {
    const { data } = await unwrap(
      'github',
      this.client.GET('/repos/{owner}/{repo}/pulls/{pull_number}', {
        params: { path: { ...this.path, pull_number: id } },
      }),
    );
    return new GithubPullRequest(toPullRequestData(data), this);
  }

  async createPr(
    title: string,
    body: string,
    targetBranch: string,
    sourceBranch: string,
  ) {
    const { data } = await unwrap(
      'github',
      this.client.POST('/repos/{owner}/{repo}/pulls', {
        params: { path: this.path },
        body: { title, body, base: targetBranch, head: sourceBranch },
      }),
    );
    return new GithubPullRequest(toPullRequestData(data), this);
  }

  async getFileContent(path: string, ref?: string) {
    const params = { path: { ...this.path, path }, query: { ref } };
    const { data } = await unwrap(
      'github',
      this.client.GET('/repos/{owner}/{repo}/contents/{path}', { params }),
    );
    if (Array.isArray(data) || !('type' in data) || data.type !== 'file') {
      const type = Array.isArray(data) ? 'dir' : data.type;
      throw new ForgeError(`${path} is a ${type}, not a file`);
    }
    if ('encoding' in data && data.encoding === 'base64') {
      return decodeBase64(data.content ?? '');
    }

    // Files over 1 MB come back without content. The raw media type
    // returns them (up to 100 MB).
    const { data: raw } = await unwrap(
      'github',
      this.client.GET('/repos/{owner}/{repo}/contents/{path}', {
        params,
        headers: { Accept: 'application/vnd.github.raw+json' },
        parseAs: 'text',
      }),
    );
    return raw;
  }

  async setCommitStatus(
    sha: string,
    state: CommitStatus,
    { targetUrl, description, context }: CommitFlagOptions = {},
  ) {
    const { data } = await unwrap(
      'github',
      this.client.POST('/repos/{owner}/{repo}/statuses/{sha}', {
        params: { path: { ...this.path, sha } },
        body: {
          state: toGithubState(state),
          target_url: targetUrl,
          description,
          context,
        },
      }),
    );
    return toCommitFlag(data, sha);
  }

  async getCommitStatuses(sha: string) {
    const items = await collectPages((page) =>
      unwrap(
        'github',
        this.client.GET('/repos/{owner}/{repo}/commits/{ref}/statuses', {
          params: {
            path: { ...this.path, ref: sha },
            query: { per_page: 100, page },
          },
        }),
      ),
    );
    return items.map((status) => toCommitFlag(status, sha));
  }

  async refresh() {
    const { data } = await unwrap(
      'github',
      this.client.GET('/repos/{owner}/{repo}', { params: { path: this.path } }),
    );
    this.data = toProjectData(data);
    return this;
  }
}
