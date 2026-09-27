import type { CommentData, IterateOptions } from '../../abstract/comment.js';
import { GitlabComment } from './comment.js';
import { OperationNotSupported } from '../../abstract/errors.js';
import { Issue } from '../../abstract/issue.js';
import { unwrap } from '../../http.js';
import { toIssueData } from './mappers.js';
import * as notes from './notes.js';
import type { paths } from './openapi.js';
import type { GitlabProject } from './project.js';

type UpdateBody = NonNullable<
  paths['/api/v4/projects/{id}/issues/{issue_iid}']['put']['requestBody']
>['content']['application/json'];

export class GitlabIssue extends Issue {
  declare readonly project: GitlabProject;
  readonly noteable = 'issues';

  private async update(body: UpdateBody) {
    const { data } = await unwrap(
      'gitlab',
      this.project.client.PUT('/api/v4/projects/{id}/issues/{issue_iid}', {
        params: { path: { id: this.project.fullRepoName, issue_iid: this.id } },
        body,
      }),
    );
    this.data = toIssueData(data);
    return this;
  }

  iterateComments(options?: IterateOptions) {
    return notes.iterateNotes(this, options);
  }

  getComment(commentId: number) {
    return notes.getNote(this, commentId);
  }

  protected newComment(data: CommentData) {
    return new GitlabComment(data, this);
  }

  protected performComment(body: string) {
    return notes.createNote(this, body);
  }

  protected performClose() {
    return this.update({ state_event: 'close' });
  }

  protected performSetTitle(title: string) {
    return this.update({ title });
  }

  protected performSetDescription(description: string) {
    return this.update({ description });
  }

  protected performAddLabel(labels: string[]) {
    return this.update({ add_labels: labels });
  }

  protected async performAddAssignee(usernames: string[]) {
    const wanted = [...new Set([...this.assignees, ...usernames])];
    await this.update({
      assignee_ids: await this.project.service.getUserIds(wanted),
    });
    assertAssigned(wanted, this.assignees);
    return this;
  }

  async refresh() {
    const { data } = await unwrap(
      'gitlab',
      this.project.client.GET('/api/v4/projects/{id}/issues/{issue_iid}', {
        params: { path: { id: this.project.fullRepoName, issue_iid: this.id } },
      }),
    );
    this.data = toIssueData(data);
    return this;
  }
}

/**
 * GitLab Free keeps only the first assignee and doesn't report an error.
 * Surface that instead of silently dropping people.
 */
export function assertAssigned(wanted: string[], actual: string[]) {
  const missing = wanted.filter((u) => !actual.includes(u));
  if (missing.length) {
    throw new OperationNotSupported(
      `GitLab did not assign ${missing.join(', ')}. ` +
        'Multiple assignees need GitLab Premium or Ultimate.',
    );
  }
}
