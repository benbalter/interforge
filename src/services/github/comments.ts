import type { IterateOptions } from '../../abstract/comment.js';
import { iteratePages, unwrap } from '../../http.js';
import { GithubComment } from './comment.js';
import type { GithubIssue } from './issue.js';
import { toCommentData } from './mappers.js';
import type { GithubPullRequest } from './pull-request.js';

// Issues and pull requests share GitHub's issue comments API.

type Parent = GithubIssue | GithubPullRequest;

function context(parent: Parent) {
  const { namespace: owner, repo, client } = parent.project;
  return { owner, repo, client };
}

export async function* iterateComments<P extends Parent>(
  parent: P,
  { pageSize = 100 }: IterateOptions = {},
) {
  const { owner, repo, client } = context(parent);
  const comments = iteratePages((page) =>
    unwrap(
      'github',
      client.GET('/repos/{owner}/{repo}/issues/{issue_number}/comments', {
        params: {
          path: { owner, repo, issue_number: parent.id },
          query: { per_page: pageSize, page },
        },
      }),
    ),
  );
  for await (const comment of comments) {
    yield new GithubComment(toCommentData(comment), parent);
  }
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
