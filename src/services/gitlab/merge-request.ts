import type { CommentFilter } from '../../abstract/comment.js';
import { PullRequest } from '../../abstract/pull-request.js';
import { unwrap } from '../../http.js';
import { toPullRequestData } from './mappers.js';
import * as notes from './notes.js';
import type { paths } from './openapi.js';
import type { GitlabProject } from './project.js';

type UpdateBody = NonNullable<
  paths['/api/v4/projects/{id}/merge_requests/{merge_request_iid}']['put']['requestBody']
>['content']['application/json'];

export class GitlabMergeRequest extends PullRequest {
  declare readonly project: GitlabProject;
  readonly noteable = 'merge_requests';

  private get path() {
    return { id: this.project.fullRepoName, merge_request_iid: this.id };
  }

  private async update(body: UpdateBody) {
    const { data } = await unwrap(
      'gitlab',
      this.project.client.PUT(
        '/api/v4/projects/{id}/merge_requests/{merge_request_iid}',
        { params: { path: this.path }, body },
      ),
    );
    this.data = toPullRequestData(data);
    return this;
  }

  getComments(options?: CommentFilter) {
    return notes.listNotes(this, options);
  }

  getComment(commentId: number) {
    return notes.getNote(this, commentId);
  }

  comment(body: string) {
    return notes.createNote(this, body);
  }

  close() {
    return this.update({ state_event: 'close' });
  }

  updateInfo({ title, description }: { title?: string; description?: string }) {
    return this.update({ title, description });
  }

  addLabel(...labels: string[]) {
    return this.update({ add_labels: labels });
  }

  async merge() {
    const { data } = await unwrap(
      'gitlab',
      this.project.client.PUT(
        '/api/v4/projects/{id}/merge_requests/{merge_request_iid}/merge',
        { params: { path: this.path } },
      ),
    );
    this.data = toPullRequestData(data);
    return this;
  }

  async refresh() {
    const { data } = await unwrap(
      'gitlab',
      this.project.client.GET(
        '/api/v4/projects/{id}/merge_requests/{merge_request_iid}',
        { params: { path: this.path } },
      ),
    );
    this.data = toPullRequestData(data);
    return this;
  }
}
