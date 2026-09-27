import type { CommentFilter } from '../../abstract/comment.js';
import { Issue } from '../../abstract/issue.js';
import { unwrap } from '../../http.js';
import * as comments from './comments.js';
import { toIssueData } from './mappers.js';
import type { GithubProject } from './project.js';

export class GithubIssue extends Issue {
  declare readonly project: GithubProject;

  private get path() {
    const { namespace: owner, repo } = this.project;
    return { owner, repo, issue_number: this.id };
  }

  private async update(body: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
  }) {
    const { data } = await unwrap(
      'github',
      this.project.client.PATCH('/repos/{owner}/{repo}/issues/{issue_number}', {
        params: { path: this.path },
        body,
      }),
    );
    this.data = toIssueData(data);
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

  setTitle(title: string) {
    return this.update({ title });
  }

  setDescription(description: string) {
    return this.update({ body: description });
  }

  async addLabel(...labels: string[]) {
    await comments.addLabels(this, labels);
    return this.refresh();
  }

  async addAssignee(...usernames: string[]) {
    const { data } = await unwrap(
      'github',
      this.project.client.POST(
        '/repos/{owner}/{repo}/issues/{issue_number}/assignees',
        { params: { path: this.path }, body: { assignees: usernames } },
      ),
    );
    this.data = toIssueData(data);
    return this;
  }

  async refresh() {
    const { data } = await unwrap(
      'github',
      this.project.client.GET('/repos/{owner}/{repo}/issues/{issue_number}', {
        params: { path: this.path },
      }),
    );
    this.data = toIssueData(data);
    return this;
  }
}
