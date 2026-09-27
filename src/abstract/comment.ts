export interface CommentData {
  id: number;
  body: string;
  author: string;
  created: Date;
  edited: Date;
  url: string;
}

export interface CommentFilter {
  /** Only comments whose body matches. A string is used as a regular expression. */
  filter?: string | RegExp;
  /** Only comments by this username. */
  author?: string;
  /** Newest first. Comments are oldest first by default. */
  reverse?: boolean;
}

/** A comment on an issue or pull request. Mirrors ogr/abstract/comment.py. */
export abstract class Comment<Parent = unknown> {
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

  abstract setBody(body: string): Promise<this>;

  toJSON(): CommentData {
    return { ...this.data };
  }
}

/** Shared filtering for getComments(), so every forge behaves the same. */
export function filterComments<C extends Comment>(
  comments: C[],
  { filter, author, reverse = false }: CommentFilter = {},
): C[] {
  const pattern = typeof filter === 'string' ? new RegExp(filter) : filter;
  const result = comments.filter(
    (c) =>
      (!pattern || pattern.test(c.body)) && (!author || c.author === author),
  );
  return reverse ? result.reverse() : result;
}
