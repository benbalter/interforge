import type { CommitFlagOptions } from '../../abstract/commit-flag.js';
import { IssueTrackerDisabled } from '../../abstract/errors.js';
import {
  filterPaths,
  GitProject,
  type CreateIssueOptions,
  type GetFilesOptions,
  type IssueListOptions,
} from '../../abstract/project.js';
import type { CommitStatus, PRStatus } from '../../abstract/status.js';
import type { IterateOptions } from '../../abstract/comment.js';
import { decodeBase64, iteratePages, nextPageUrl, unwrap } from '../../http.js';
import type { IssueData } from '../../abstract/issue.js';
import type { PullRequestData } from '../../abstract/pull-request.js';
import { assertAssigned, GitlabIssue } from './issue.js';
import {
  toCommitFlag,
  toGitlabState,
  toIssueData,
  toProjectData,
  toPullRequestData,
} from './mappers.js';
import { GitlabMergeRequest } from './merge-request.js';
import type { GitlabService } from './service.js';

const ISSUE_STATE = { open: 'opened', closed: 'closed', all: 'all' } as const;
const MR_STATE = {
  open: 'opened',
  closed: 'closed',
  merged: 'merged',
  all: 'all',
} as const;

export class GitlabProject extends GitProject {
  declare readonly service: GitlabService;

  get client() {
    return this.service.client;
  }

  private get id() {
    // openapi-fetch URL-encodes path params, which is what GitLab expects
    // for `namespace/project` IDs.
    return this.fullRepoName;
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
        'gitlab',
        this.client.GET('/api/v4/projects/{id}/issues', {
          params: {
            path: { id: this.id },
            query: {
              state: ISSUE_STATE[status],
              author_username: author,
              assignee_username: assignee ? [assignee] : undefined,
              labels,
              per_page: pageSize,
              page,
            },
          },
        }),
      ),
    );
    for await (const item of items)
      yield new GitlabIssue(toIssueData(item), this);
  }

  async getIssue(id: number) {
    this.assertIssues();
    const { data } = await unwrap(
      'gitlab',
      this.client.GET('/api/v4/projects/{id}/issues/{issue_iid}', {
        params: { path: { id: this.id, issue_iid: id } },
      }),
    );
    return new GitlabIssue(toIssueData(data), this);
  }

  protected newIssue(data: IssueData) {
    return new GitlabIssue(data, this);
  }

  protected newPullRequest(data: PullRequestData) {
    return new GitlabMergeRequest(data, this);
  }

  protected async performCreateIssue(
    title: string,
    body: string,
    { labels, assignees = [], private: confidential }: CreateIssueOptions = {},
  ) {
    this.assertIssues();
    const { data } = await unwrap(
      'gitlab',
      this.client.POST('/api/v4/projects/{id}/issues', {
        params: { path: { id: this.id } },
        body: {
          title,
          description: body,
          labels,
          confidential,
          assignee_ids: assignees.length
            ? await this.service.getUserIds(assignees)
            : undefined,
        },
      }),
    );
    const issue = new GitlabIssue(toIssueData(data), this);
    assertAssigned(assignees, issue.assignees);
    return issue;
  }

  async *iteratePrs({
    status = 'open',
    pageSize = 100,
  }: { status?: PRStatus } & IterateOptions = {}) {
    const items = iteratePages((page) =>
      unwrap(
        'gitlab',
        this.client.GET('/api/v4/projects/{id}/merge_requests', {
          params: {
            path: { id: this.id },
            query: { state: MR_STATE[status], per_page: pageSize, page },
          },
        }),
      ),
    );
    for await (const item of items) {
      yield new GitlabMergeRequest(toPullRequestData(item), this);
    }
  }

  async getPr(id: number) {
    const { data } = await unwrap(
      'gitlab',
      this.client.GET(
        '/api/v4/projects/{id}/merge_requests/{merge_request_iid}',
        {
          params: { path: { id: this.id, merge_request_iid: id } },
        },
      ),
    );
    return new GitlabMergeRequest(toPullRequestData(data), this);
  }

  protected async performCreatePr(
    title: string,
    body: string,
    targetBranch: string,
    sourceBranch: string,
  ) {
    const { data } = await unwrap(
      'gitlab',
      this.client.POST('/api/v4/projects/{id}/merge_requests', {
        params: { path: { id: this.id } },
        body: {
          title,
          description: body,
          target_branch: targetBranch,
          source_branch: sourceBranch,
        },
      }),
    );
    return new GitlabMergeRequest(toPullRequestData(data), this);
  }

  async getFileContent(path: string, ref?: string) {
    const { data } = await unwrap(
      'gitlab',
      this.client.GET('/api/v4/projects/{id}/repository/files/{file_path}', {
        params: {
          path: { id: this.id, file_path: path },
          // GitLab requires a ref. HEAD is the default branch.
          query: { ref: ref ?? this.defaultBranch ?? 'HEAD' },
        },
      }),
    );
    return data.encoding === 'base64'
      ? decodeBase64(data.content)
      : data.content;
  }

  async getFiles({
    ref,
    filterRegex,
    recursive = false,
  }: GetFilesOptions = {}) {
    const paths: string[] = [];
    // Keyset pagination, which GitLab recommends for large trees. Instances
    // too old for it answer with page numbers instead, so follow either.
    let next: { page_token?: string; page?: number } = {};
    for (;;) {
      const { data, response } = await unwrap(
        'gitlab',
        this.client.GET('/api/v4/projects/{id}/repository/tree', {
          params: {
            path: { id: this.id },
            query: {
              ref,
              recursive,
              pagination: 'keyset',
              per_page: 100,
              ...next,
            },
          },
        }),
      );
      paths.push(...data.filter((e) => e.type === 'blob').map((e) => e.path));
      const url = nextPageUrl(response);
      const token = url?.searchParams.get('page_token');
      const page = url?.searchParams.get('page');
      if (token) next = { page_token: token };
      else if (page) next = { page: Number(page) };
      else break;
    }
    return filterPaths(paths, filterRegex);
  }

  protected async performSetCommitStatus(
    sha: string,
    state: CommitStatus,
    { targetUrl, description, context }: CommitFlagOptions = {},
  ) {
    const { data } = await unwrap(
      'gitlab',
      this.client.POST('/api/v4/projects/{id}/statuses/{sha}', {
        params: { path: { id: this.id, sha } },
        body: {
          state: toGitlabState(state),
          target_url: targetUrl,
          description,
          name: context,
        },
      }),
    );
    return toCommitFlag(data);
  }

  async *iterateCommitStatuses(
    sha: string,
    { pageSize = 100 }: IterateOptions = {},
  ) {
    const items = iteratePages((page) =>
      unwrap(
        'gitlab',
        this.client.GET(
          '/api/v4/projects/{id}/repository/commits/{sha}/statuses',
          {
            params: {
              path: { id: this.id, sha },
              query: { all: true, per_page: pageSize, page },
            },
          },
        ),
      ),
    );
    for await (const status of items) yield toCommitFlag(status);
  }

  async refresh() {
    const { data } = await unwrap(
      'gitlab',
      this.client.GET('/api/v4/projects/{id}', {
        params: { path: { id: this.id } },
      }),
    );
    this.data = toProjectData(data);
    return this;
  }
}
