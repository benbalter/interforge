import { collect, pageSizeFor } from '../http.js';
import type { IterateOptions } from './comment.js';
import type { CommitFlag, CommitFlagOptions } from './commit-flag.js';
import type { Issue, IssueData } from './issue.js';
import type { PullRequest, PullRequestData } from './pull-request.js';
import type { GitService } from './service.js';
import type { CommitStatus, IssueStatus, PRStatus } from './status.js';

export interface GitProjectData {
  /** Owner or group path. GitLab namespaces may be nested (`group/subgroup`). */
  namespace: string;
  repo: string;
  webUrl: string;
  description: string;
  defaultBranch: string | null;
  isPrivate: boolean;
  hasIssues: boolean;
}

export interface ListOptions {
  /** At most this many. Only the pages needed are fetched. */
  limit?: number;
}

export interface IssueListOptions {
  status?: IssueStatus;
  author?: string;
  assignee?: string;
  labels?: string[];
}

export interface GetFilesOptions {
  /** Branch, tag or commit. Defaults to the default branch. */
  ref?: string;
  /** Only paths matching this. A string is used as a regular expression. */
  filterRegex?: string | RegExp;
  /** Include files in subdirectories. Default false: top level only. */
  recursive?: boolean;
}

/** Applies getFiles()' filterRegex, the same way on every forge. */
export function filterPaths(paths: string[], filterRegex?: string | RegExp) {
  if (!filterRegex) return paths;
  const pattern =
    typeof filterRegex === 'string' ? new RegExp(filterRegex) : filterRegex;
  return paths.filter((path) => pattern.test(path));
}

export interface CreateIssueOptions {
  labels?: string[];
  assignees?: string[];
  /** Confidential issue. GitLab only. */
  private?: boolean;
}

/** A repository (GitHub) or project (GitLab). Mirrors ogr/abstract/git_project.py. */
export abstract class GitProject {
  constructor(
    protected data: GitProjectData,
    readonly service: GitService,
  ) {}

  get namespace() {
    return this.data.namespace;
  }
  get repo() {
    return this.data.repo;
  }
  get fullRepoName() {
    return `${this.data.namespace}/${this.data.repo}`;
  }
  get webUrl() {
    return this.data.webUrl;
  }
  get description() {
    return this.data.description;
  }
  get defaultBranch() {
    return this.data.defaultBranch;
  }
  get isPrivate() {
    return this.data.isPrivate;
  }
  get hasIssues() {
    return this.data.hasIssues;
  }

  /** Issues, fetched a page at a time as you iterate. */
  abstract iterateIssues(
    options?: IssueListOptions & IterateOptions,
  ): AsyncIterable<Issue>;

  getIssueList(options: IssueListOptions & ListOptions = {}): Promise<Issue[]> {
    const { limit, ...filters } = options;
    return collect(
      this.iterateIssues({ ...filters, pageSize: pageSizeFor(limit) }),
      limit,
    );
  }

  abstract getIssue(id: number): Promise<Issue>;
  async createIssue(
    title: string,
    body: string,
    options: CreateIssueOptions = {},
  ): Promise<Issue> {
    if (
      !this.service.skipWrite('createIssue', this.fullRepoName, {
        title,
        body,
        ...options,
      })
    ) {
      return this.performCreateIssue(title, body, options);
    }
    return this.newIssue({
      id: 0,
      title,
      description: body,
      status: 'open',
      url: this.webUrl,
      author: await this.service.dryRunAuthor(),
      created: new Date(),
      labels: options.labels ?? [],
      assignees: options.assignees ?? [],
      private: options.private ?? false,
    });
  }

  /** Pull requests, fetched a page at a time as you iterate. */
  abstract iteratePrs(
    options?: { status?: PRStatus } & IterateOptions,
  ): AsyncIterable<PullRequest>;

  getPrList(
    options: { status?: PRStatus } & ListOptions = {},
  ): Promise<PullRequest[]> {
    const { limit, ...filters } = options;
    return collect(
      this.iteratePrs({ ...filters, pageSize: pageSizeFor(limit) }),
      limit,
    );
  }

  abstract getPr(id: number): Promise<PullRequest>;
  async createPr(
    title: string,
    body: string,
    targetBranch: string,
    sourceBranch: string,
  ): Promise<PullRequest> {
    const details = { title, body, targetBranch, sourceBranch };
    if (!this.service.skipWrite('createPr', this.fullRepoName, details)) {
      return this.performCreatePr(title, body, targetBranch, sourceBranch);
    }
    return this.newPullRequest({
      id: 0,
      title,
      description: body,
      status: 'open',
      url: this.webUrl,
      author: await this.service.dryRunAuthor(),
      created: new Date(),
      labels: [],
      sourceBranch,
      targetBranch,
      headCommit: '',
    });
  }

  /**
   * A file's contents as UTF-8 text, from `ref` (a branch, tag or commit), or
   * the default branch. Throws NotFoundError for missing files and ForgeError
   * for paths that aren't files.
   */
  abstract getFileContent(path: string, ref?: string): Promise<string>;

  /** Paths of the files (not directories) in the repository. Mirrors ogr's get_files(). */
  abstract getFiles(options?: GetFilesOptions): Promise<string[]>;

  async setCommitStatus(
    sha: string,
    state: CommitStatus,
    options: CommitFlagOptions = {},
  ): Promise<CommitFlag> {
    if (
      !this.service.skipWrite(
        'setCommitStatus',
        `${this.fullRepoName}@${sha}`,
        { state, ...options },
      )
    ) {
      return this.performSetCommitStatus(sha, state, options);
    }
    return {
      commit: sha,
      state,
      context: options.context ?? 'default',
      description: options.description ?? null,
      url: options.targetUrl ?? null,
      created: new Date(),
    };
  }
  /** Statuses on a commit, fetched a page at a time as you iterate. */
  abstract iterateCommitStatuses(
    sha: string,
    options?: IterateOptions,
  ): AsyncIterable<CommitFlag>;

  getCommitStatuses(
    sha: string,
    { limit }: ListOptions = {},
  ): Promise<CommitFlag[]> {
    return collect(
      this.iterateCommitStatuses(sha, { pageSize: pageSizeFor(limit) }),
      limit,
    );
  }

  abstract refresh(): Promise<this>;

  protected abstract newIssue(data: IssueData): Issue;
  protected abstract newPullRequest(data: PullRequestData): PullRequest;
  protected abstract performCreateIssue(
    title: string,
    body: string,
    options: CreateIssueOptions,
  ): Promise<Issue>;
  protected abstract performCreatePr(
    title: string,
    body: string,
    targetBranch: string,
    sourceBranch: string,
  ): Promise<PullRequest>;
  protected abstract performSetCommitStatus(
    sha: string,
    state: CommitStatus,
    options: CommitFlagOptions,
  ): Promise<CommitFlag>;

  toJSON(): GitProjectData {
    return { ...this.data };
  }
}
