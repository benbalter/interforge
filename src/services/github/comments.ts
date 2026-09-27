import type { CommentFilter } from '../../abstract/comment.js';
import { filterComments } from '../../abstract/comment.js';
import type { GitProject } from '../../abstract/project.js';
import { collectPages, unwrap } from '../../http.js';
import { GithubComment } from './comment.js';
import { toCommentData } from './mappers.js';
import type { GithubService } from './service.js';

// Issues and pull requests share GitHub's issue comments API.

interface Parent {
  id: number;
  project: GitProject;
}

function context(parent: Parent) {
  const { namespace: owner, repo, service } = parent.project;
  return { owner, repo, client: (service as GithubService).client };
}

export async function listComments<P extends Parent>(
  parent: P,
  options?: CommentFilter,
) {
  const { owner, repo, client } = context(parent);
  const comments = await collectPages((page) =>
    unwrap(
      'github',
      client.GET('/repos/{owner}/{repo}/issues/{issue_number}/comments', {
        params: {
          path: { owner, repo, issue_number: parent.id },
          query: { per_page: 100, page },
        },
      }),
    ),
  );
  return filterComments(
    comments.map((c) => new GithubComment(toCommentData(c), parent)),
    options,
  );
}

export async function getComment<P extends Parent>(parent: P, id: number) {
  const { owner, repo, client } = context(parent);
  const { data } = await unwrap(
    'github',
    client.GET('/repos/{owner}/{repo}/issues/comments/{comment_id}', {
      params: { path: { owner, repo, comment_id: id } },
    }),
  );
  return new GithubComment(toCommentData(data), parent);
}

export async function createComment<P extends Parent>(parent: P, body: string) {
  const { owner, repo, client } = context(parent);
  const { data } = await unwrap(
    'github',
    client.POST('/repos/{owner}/{repo}/issues/{issue_number}/comments', {
      params: { path: { owner, repo, issue_number: parent.id } },
      body: { body },
    }),
  );
  return new GithubComment(toCommentData(data), parent);
}

export async function addLabels(parent: Parent, labels: string[]) {
  const { owner, repo, client } = context(parent);
  await unwrap(
    'github',
    client.POST('/repos/{owner}/{repo}/issues/{issue_number}/labels', {
      params: { path: { owner, repo, issue_number: parent.id } },
      body: { labels },
    }),
  );
}
