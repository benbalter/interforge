import { Comment } from '../../abstract/comment.js';
import { unwrap } from '../../http.js';
import type { GithubService } from './service.js';
import { toCommentData } from './mappers.js';
import type { GitProject } from '../../abstract/project.js';

/**
 * A comment on a GitHub issue or pull request. Both use the issue comments
 * API, so one class covers both.
 */
export class GithubComment<
  Parent extends { project: GitProject },
> extends Comment<Parent> {
  private get client() {
    return (this.parent.project.service as GithubService).client;
  }

  async setBody(body: string) {
    const { namespace: owner, repo } = this.parent.project;
    const { data } = await unwrap(
      'github',
      this.client.PATCH('/repos/{owner}/{repo}/issues/comments/{comment_id}', {
        params: { path: { owner, repo, comment_id: this.id } },
        body: { body },
      }),
    );
    this.data = toCommentData(data);
    return this;
  }
}
