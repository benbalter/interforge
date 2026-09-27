export interface CommentData {
  id: number;
  body: string;
  author: string;
  created: Date;
  edited: Date;
  url: string;
}

import { collect, pageSizeFor } from '../http.js';
import type { GitProject } from './project.js';

export interface CommentFilter {
  /** Only comments whose body matches. A string is used as a regular expression. */
  filter?: string | RegExp;
  /** Only comments by this username. */
  author?: string;
  /** Newest first. Comments are oldest first by default. */
  reverse?: boolean;
  /** At most this many (the newest ones, with `reverse`). */
  limit?: number;
}

/** A comment that dry-run mode pretends to have posted. */
export async function standInComment(
  parent: { project: GitProject; url: string },
  body: string,
): Promise<CommentData> {
  const now = new Date();
  return {
    id: 0,
    body,
    author: await parent.project.service.dryRunAuthor(),
    created: now,
    edited: now,
    url: parent.url,
  };
}

export interface IterateOptions {
  /** Items per request, up to 100. */
  pageSize?: number;
}

/** A comment on an issue or pull request. Mirrors ogr/abstract/comment.py. */
export abstract class Comment<
  Parent extends { project: GitProject; url: string } = {
    project: GitProject;
    url: string;
  },
> {
  constructor(
    protected data: CommentData,
    readonly parent: Parent,
  ) {}

  get id() {
    return this.data.id;
  }
  get body() {
    return this.data.body;
  }
  get author() {
    return this.data.author;
  }
  get created() {
    return this.data.created;
  }
  get edited() {
    return this.data.edited;
  }
  get url() {
    return this.data.url;
  }

  async setBody(body: string): Promise<this> {
    const { service, fullRepoName } = this.parent.project;
    if (
      service.skipWrite('setBody', `${fullRepoName} comment ${this.id}`, {
        body,
      })
    ) {
      this.data = { ...this.data, body, edited: new Date() };
      return this;
    }
    return this.performSetBody(body);
  }

  protected abstract performSetBody(body: string): Promise<this>;

  toJSON(): CommentData {
    return { ...this.data };
  }
}

/** Comments matching `filter` and `author`, as they stream in. */
export async function* matchingComments<C extends Comment>(
  comments: AsyncIterable<C>,
  { filter, author }: CommentFilter = {},
): AsyncGenerator<C> {
  const pattern = typeof filter === 'string' ? new RegExp(filter) : filter;
  for await (const comment of comments) {
    if (
      (!pattern || pattern.test(comment.body)) &&
      (!author || comment.author === author)
    ) {
      yield comment;
    }
  }
}

/**
 * getComments() for every forge: filters, then limits. Newest-first needs
 * every comment, so `reverse` fetches them all.
 */
export async function listComments<C extends Comment>(
  iterate: (options: IterateOptions) => AsyncIterable<C>,
  options: CommentFilter = {},
): Promise<C[]> {
  const { filter, author, reverse, limit } = options;
  const unfiltered = !filter && !author && !reverse;
  const comments = matchingComments(
    iterate({ pageSize: pageSizeFor(unfiltered ? limit : undefined) }),
    options,
  );
  if (!reverse) return collect(comments, limit);
  return (await collect(comments)).reverse().slice(0, limit);
}
