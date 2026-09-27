import type { CommitFlagOptions } from '../../abstract/commit-flag.js';
import {
  ForgeError,
  IssueTrackerDisabled,
  OperationNotSupported,
} from '../../abstract/errors.js';
import {
  filterPaths,
  GitProject,
  type CreateIssueOptions,
  type GetFilesOptions,
  type IssueListOptions,
} from '../../abstract/project.js';
import type { CommitStatus, PRStatus } from '../../abstract/status.js';
import type { IterateOptions } from '../../abstract/comment.js';
import { decodeBase64, iteratePages, unwrap } from '../../http.js';
import type { IssueData } from '../../abstract/issue.js';
import type { PullRequestData } from '../../abstract/pull-request.js';
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

  async *iterateIssues({
    status = 'open',
    author,
    assignee,
    labels,
    pageSize = 100,
  }: IssueListOptions & IterateOptions = {}) {
    this.assertIssues();
    const items = iteratePages((page) =>
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
              per_page: pageSize,
              page,
            },
          },
        }),
      ),
    );
    for await (const item of items) {
      // GitHub lists pull requests as issues too.
      if (!item.pull_request) yield new GithubIssue(toIssueData(item), this);
    }
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

  protected newIssue(data: IssueData) {
    return new GithubIssue(data, this);
  }

  protected newPullRequest(data: PullRequestData) {
    return new GithubPullRequest(data, this);
  }

  protected async performCreateIssue(
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

  async *iteratePrs({
    status = 'open',
    pageSize = 100,
  }: { status?: PRStatus } & IterateOptions = {}) {
    // GitHub has no merged filter: list closed ones and keep the merged.
    const merged = status === 'merged';
    const items = iteratePages((page) =>
      unwrap(
        'github',
        this.client.GET('/repos/{owner}/{repo}/pulls', {
          params: {
            path: this.path,
            query: {
              state: merged ? 'closed' : status,
              per_page: merged ? 100 : pageSize,
              page,
            },
          },
        }),
      ),
    );
    for await (const item of items) {
      const pr = new GithubPullRequest(toPullRequestData(item), this);
      if (!merged || pr.status === 'merged') yield pr;
    }
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

  protected async performCreatePr(
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

  async getFiles({
    ref,
    filterRegex,
    recursive = false,
  }: GetFilesOptions = {}) {
    const getTree = async (sha: string, recursive: boolean) =>
      (
        await unwrap(
          'github',
          this.client.GET('/repos/{owner}/{repo}/git/trees/{tree_sha}', {
            params: {
              path: { ...this.path, tree_sha: sha },
              query: recursive ? { recursive: '1' } : {},
            },
          }),
        )
      ).data;

    const root = ref ?? this.defaultBranch ?? 'HEAD';
    const tree = await getTree(root, recursive);
    let paths: string[] = [];

    if (!recursive || !tree.truncated) {
      paths = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
    } else {
      // Recursive trees stop at 100,000 entries or 7 MB. GitHub's advice is
      // to walk the tree one level at a time instead.
      const queue = [{ sha: root, prefix: '' }];
      while (queue.length) {
        const { sha, prefix } = queue.shift()!;
        for (const entry of (await getTree(sha, false)).tree) {
          const path = prefix + entry.path;
          if (entry.type === 'blob') paths.push(path);
          if (entry.type === 'tree')
            queue.push({ sha: entry.sha, prefix: `${path}/` });
        }
      }
    }
    return filterPaths(paths, filterRegex);
  }

  protected async performSetCommitStatus(
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

  async *iterateCommitStatuses(
    sha: string,
    { pageSize = 100 }: IterateOptions = {},
  ) {
    const items = iteratePages((page) =>
      unwrap(
        'github',
        this.client.GET('/repos/{owner}/{repo}/commits/{ref}/statuses', {
          params: {
            path: { ...this.path, ref: sha },
            query: { per_page: pageSize, page },
          },
        }),
      ),
    );
    for await (const status of items) yield toCommitFlag(status, sha);
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
