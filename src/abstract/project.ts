import type { CommitFlag, CommitFlagOptions } from './commit-flag.js';
import type { Issue } from './issue.js';
import type { PullRequest } from './pull-request.js';
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

export interface IssueListOptions {
  status?: IssueStatus;
  author?: string;
  assignee?: string;
  labels?: string[];
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

  abstract getIssueList(options?: IssueListOptions): Promise<Issue[]>;
  abstract getIssue(id: number): Promise<Issue>;
  abstract createIssue(
    title: string,
    body: string,
    options?: CreateIssueOptions,
  ): Promise<Issue>;

  abstract getPrList(options?: { status?: PRStatus }): Promise<PullRequest[]>;
  abstract getPr(id: number): Promise<PullRequest>;
  abstract createPr(
    title: string,
    body: string,
    targetBranch: string,
    sourceBranch: string,
  ): Promise<PullRequest>;

  /**
   * A file's contents as UTF-8 text, from `ref` (a branch, tag or commit), or
   * the default branch. Throws NotFoundError for missing files and ForgeError
   * for paths that aren't files.
   */
  abstract getFileContent(path: string, ref?: string): Promise<string>;

  abstract setCommitStatus(
    sha: string,
    state: CommitStatus,
    options?: CommitFlagOptions,
  ): Promise<CommitFlag>;
  abstract getCommitStatuses(sha: string): Promise<CommitFlag[]>;

  abstract refresh(): Promise<this>;

  toJSON(): GitProjectData {
    return { ...this.data };
  }
}
