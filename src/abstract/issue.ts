import {
  listComments,
  standInComment,
  type Comment,
  type CommentData,
  type CommentFilter,
  type IterateOptions,
} from './comment.js';
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

  /** Comments, oldest first, fetched a page at a time as you iterate. */
  abstract iterateComments(
    options?: IterateOptions,
  ): AsyncIterable<IssueComment>;

  /** Comments, oldest first unless `reverse`. */
  getComments(options?: CommentFilter): Promise<IssueComment[]> {
    return listComments((o) => this.iterateComments(o), options);
  }
  abstract getComment(commentId: number): Promise<IssueComment>;

  // Writes. In dry-run mode these are recorded, applied to this object only,
  // and not sent.

  async comment(body: string): Promise<IssueComment> {
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

  addLabel(...labels: string[]): Promise<this> {
    return this.write(
      'addLabel',
      { labels },
      { labels: [...new Set([...this.labels, ...labels])] },
      () => this.performAddLabel(labels),
    );
  }

  addAssignee(...usernames: string[]): Promise<this> {
    return this.write(
      'addAssignee',
      { usernames },
      { assignees: [...new Set([...this.assignees, ...usernames])] },
      () => this.performAddAssignee(usernames),
    );
  }

  setTitle(title: string): Promise<this> {
    return this.write('setTitle', { title }, { title }, () =>
      this.performSetTitle(title),
    );
  }

  setDescription(description: string): Promise<this> {
    return this.write('setDescription', { description }, { description }, () =>
      this.performSetDescription(description),
    );
  }

  private skipWrite(action: string, details: Record<string, unknown>) {
    const { service, fullRepoName } = this.project;
    return service.skipWrite(action, `${fullRepoName}#${this.id}`, details);
  }

  private async write(
    action: string,
    details: Record<string, unknown>,
    changes: Partial<IssueData>,
    perform: () => Promise<this>,
  ): Promise<this> {
    if (!this.skipWrite(action, details)) return perform();
    this.data = { ...this.data, ...changes };
    return this;
  }

  protected abstract newComment(data: CommentData): IssueComment;
  protected abstract performComment(body: string): Promise<IssueComment>;
  protected abstract performClose(): Promise<this>;
  protected abstract performAddLabel(labels: string[]): Promise<this>;
  protected abstract performAddAssignee(usernames: string[]): Promise<this>;
  protected abstract performSetTitle(title: string): Promise<this>;
  protected abstract performSetDescription(description: string): Promise<this>;
  /** Re-fetch from the forge. */
  abstract refresh(): Promise<this>;

  toJSON(): IssueData {
    return { ...this.data };
  }
}
