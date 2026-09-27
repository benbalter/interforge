import type { Comment, CommentFilter } from './comment.js';
import type { GitProject } from './project.js';

export interface IssueData {
  /** The per-project number (GitHub `number`, GitLab `iid`). */
  id: number;
  title: string;
  description: string;
  status: 'open' | 'closed';
  url: string;
  author: string;
  created: Date;
  labels: string[];
  assignees: string[];
  private: boolean;
}

export type IssueComment = Comment<Issue>;

/** Mirrors ogr/abstract/issue.py, with async methods instead of lazy properties. */
export abstract class Issue {
  constructor(
    protected data: IssueData,
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
  get assignees() {
    return this.data.assignees;
  }
  get private() {
    return this.data.private;
  }

  abstract getComments(options?: CommentFilter): Promise<IssueComment[]>;
  abstract getComment(commentId: number): Promise<IssueComment>;
  abstract comment(body: string): Promise<IssueComment>;
  abstract close(): Promise<this>;
  abstract addLabel(...labels: string[]): Promise<this>;
  abstract addAssignee(...usernames: string[]): Promise<this>;
  abstract setTitle(title: string): Promise<this>;
  abstract setDescription(description: string): Promise<this>;
  /** Re-fetch from the forge. */
  abstract refresh(): Promise<this>;

  toJSON(): IssueData {
    return { ...this.data };
  }
}
