import {
  listComments,
  standInComment,
  type Comment,
  type CommentData,
  type CommentFilter,
  type IterateOptions,
} from './comment.js';
import type { CommitFlag } from './commit-flag.js';
import type { GitProject } from './project.js';

export interface PullRequestData {
  /** The per-project number (GitHub `number`, GitLab `iid`). */
  id: number;
  title: string;
  description: string;
  status: 'open' | 'closed' | 'merged';
  url: string;
  author: string;
  created: Date;
  labels: string[];
  sourceBranch: string;
  targetBranch: string;
  headCommit: string;
}

export type PRComment = Comment<PullRequest>;

/** A pull request (GitHub) or merge request (GitLab). Mirrors ogr/abstract/pull_request.py. */
export abstract class PullRequest {
  constructor(
    protected data: PullRequestData,
    readonly project: GitProject,
  ) {}

  get id() {
    return this.data.id;
  }
  get title() {
    return this.data.title;
  }
  get description() {
    return this.data.description;
  }
  get status() {
    return this.data.status;
  }
  get url() {
    return this.data.url;
  }
  get author() {
    return this.data.author;
  }
  get created() {
    return this.data.created;
  }
  get labels() {
    return this.data.labels;
  }
  get sourceBranch() {
    return this.data.sourceBranch;
  }
  get targetBranch() {
    return this.data.targetBranch;
  }
  get headCommit() {
    return this.data.headCommit;
  }

  /** Comments, oldest first, fetched a page at a time as you iterate. */
  abstract iterateComments(options?: IterateOptions): AsyncIterable<PRComment>;

  /** Comments, oldest first unless `reverse`. */
  getComments(options?: CommentFilter): Promise<PRComment[]> {
    return listComments((o) => this.iterateComments(o), options);
  }
  abstract getComment(commentId: number): Promise<PRComment>;

  // Writes. In dry-run mode these are recorded, applied to this object only,
  // and not sent.

  async comment(body: string): Promise<PRComment> {
    if (this.skipWrite('comment', { body })) {
      return this.newComment(await standInComment(this, body));
    }
    return this.performComment(body);
  }

  close(): Promise<this> {
    return this.write('close', {}, { status: 'closed' }, () =>
      this.performClose(),
    );
  }

  merge(): Promise<this> {
    return this.write('merge', {}, { status: 'merged' }, () =>
      this.performMerge(),
    );
  }

  addLabel(...labels: string[]): Promise<this> {
    return this.write(
      'addLabel',
      { labels },
      { labels: [...new Set([...this.labels, ...labels])] },
      () => this.performAddLabel(labels),
    );
  }

  updateInfo(changes: { title?: string; description?: string }): Promise<this> {
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    return this.write('updateInfo', defined, defined, () =>
      this.performUpdateInfo(changes),
    );
  }

  private skipWrite(action: string, details: Record<string, unknown>) {
    const { service, fullRepoName } = this.project;
    return service.skipWrite(action, `${fullRepoName}#${this.id}`, details);
  }

  private async write(
    action: string,
    details: Record<string, unknown>,
    changes: Partial<PullRequestData>,
    perform: () => Promise<this>,
  ): Promise<this> {
    if (!this.skipWrite(action, details)) return perform();
    this.data = { ...this.data, ...changes };
    return this;
  }

  protected abstract newComment(data: CommentData): PRComment;
  protected abstract performComment(body: string): Promise<PRComment>;
  protected abstract performClose(): Promise<this>;
  protected abstract performMerge(): Promise<this>;
  protected abstract performAddLabel(labels: string[]): Promise<this>;
  protected abstract performUpdateInfo(changes: {
    title?: string;
    description?: string;
  }): Promise<this>;
  abstract refresh(): Promise<this>;

  /** Statuses on the head commit. */
  getStatuses(options?: { limit?: number }): Promise<CommitFlag[]> {
    return this.project.getCommitStatuses(this.headCommit, options);
  }

  toJSON(): PullRequestData {
    return { ...this.data };
  }
}
