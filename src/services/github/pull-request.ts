import type { CommentFilter } from '../../abstract/comment.js';
import { PullRequest } from '../../abstract/pull-request.js';
import { unwrap } from '../../http.js';
import * as comments from './comments.js';
import { toPullRequestData } from './mappers.js';
import type { GithubProject } from './project.js';

export class GithubPullRequest extends PullRequest {
  declare readonly project: GithubProject;

  private get path() {
    const { namespace: owner, repo } = this.project;
    return { owner, repo, pull_number: this.id };
  }

  private async update(body: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
  }) {
    const { data } = await unwrap(
      'github',
      this.project.client.PATCH('/repos/{owner}/{repo}/pulls/{pull_number}', {
        params: { path: this.path },
        body,
      }),
    );
    this.data = toPullRequestData(data);
    return this;
  }

  getComments(options?: CommentFilter) {
    return comments.listComments(this, options);
  }

  getComment(commentId: number) {
    return comments.getComment(this, commentId);
  }

  comment(body: string) {
    return comments.createComment(this, body);
  }

  close() {
    return this.update({ state: 'closed' });
  }

  updateInfo({ title, description }: { title?: string; description?: string }) {
    return this.update({ title, body: description });
  }

  async merge() {
    await unwrap(
      'github',
      this.project.client.PUT(
        '/repos/{owner}/{repo}/pulls/{pull_number}/merge',
        {
          params: { path: this.path },
        },
      ),
    );
    return this.refresh();
  }

  async addLabel(...labels: string[]) {
    await comments.addLabels(this, labels);
    return this.refresh();
  }

  async refresh() {
    const { data } = await unwrap(
      'github',
      this.project.client.GET('/repos/{owner}/{repo}/pulls/{pull_number}', {
        params: { path: this.path },
      }),
    );
    this.data = toPullRequestData(data);
    return this;
  }
}
