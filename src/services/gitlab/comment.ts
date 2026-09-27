import { Comment } from '../../abstract/comment.js';
import { unwrap } from '../../http.js';
import { toCommentData } from './mappers.js';
import type { GitlabIssue } from './issue.js';
import type { GitlabMergeRequest } from './merge-request.js';

type Parent = GitlabIssue | GitlabMergeRequest;

/** A note on a GitLab issue or merge request. */
export class GitlabComment<P extends Parent = Parent> extends Comment<P> {
  protected async performSetBody(body: string) {
    const { client, fullRepoName } = this.parent.project;
    const params = {
      path: { id: fullRepoName, noteable_id: this.parent.id, note_id: this.id },
    };
    const { data } = await unwrap(
      'gitlab',
      this.parent.noteable === 'issues'
        ? client.PUT(
            '/api/v4/projects/{id}/issues/{noteable_id}/notes/{note_id}',
            {
              params,
              body: { body },
            },
          )
        : client.PUT(
            '/api/v4/projects/{id}/merge_requests/{noteable_id}/notes/{note_id}',
            { params, body: { body } },
          ),
    );
    this.data = toCommentData(data, this.parent.url);
    return this;
  }
}
