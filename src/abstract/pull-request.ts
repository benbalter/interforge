import type { Comment, CommentFilter } from './comment.js';
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

  abstract getComments(options?: CommentFilter): Promise<PRComment[]>;
  abstract getComment(commentId: number): Promise<PRComment>;
  abstract comment(body: string): Promise<PRComment>;
  abstract close(): Promise<this>;
  abstract merge(): Promise<this>;
  abstract addLabel(...labels: string[]): Promise<this>;
  abstract updateInfo(changes: {
    title?: string;
    description?: string;
  }): Promise<this>;
  abstract refresh(): Promise<this>;

  /** Statuses on the head commit. */
  getStatuses(): Promise<CommitFlag[]> {
    return this.project.getCommitStatuses(this.headCommit);
  }

  toJSON(): PullRequestData {
    return { ...this.data };
  }
}
