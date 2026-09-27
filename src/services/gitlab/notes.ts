import { filterComments, type CommentFilter } from '../../abstract/comment.js';
import { collectPages, unwrap } from '../../http.js';
import { GitlabComment } from './comment.js';
import type { GitlabIssue } from './issue.js';
import { toCommentData } from './mappers.js';
import type { GitlabMergeRequest } from './merge-request.js';

// Issues and merge requests have parallel notes APIs. The generated types
// differ only by path, so pick the path by noteable type.

type Parent = GitlabIssue | GitlabMergeRequest;

function params(parent: Parent) {
  return { id: parent.project.fullRepoName, noteable_id: parent.id };
}

export async function listNotes<P extends Parent>(
  parent: P,
  options?: CommentFilter,
) {
  const { client } = parent.project;
  const notes = await collectPages((page) => {
    const init = {
      params: {
        path: params(parent),
        query: {
          // Leave out system notes ("added label bug") on the server...
          activity_filter: 'only_comments' as const,
          sort: 'asc' as const,
          order_by: 'created_at' as const,
          per_page: 100,
          page,
        },
      },
    };
    return unwrap(
      'gitlab',
      parent.noteable === 'issues'
        ? client.GET('/api/v4/projects/{id}/issues/{noteable_id}/notes', init)
        : client.GET(
            '/api/v4/projects/{id}/merge_requests/{noteable_id}/notes',
            init,
          ),
    );
  });
  const comments = notes
    // ...and here, for instances that ignore activity_filter.
    .filter((note) => !note.system)
    .map((note) => new GitlabComment(toCommentData(note, parent.url), parent));
  return filterComments(comments, options);
}

export async function getNote<P extends Parent>(parent: P, noteId: number) {
  const { client } = parent.project;
  const init = { params: { path: { ...params(parent), note_id: noteId } } };
  const { data } = await unwrap(
    'gitlab',
    parent.noteable === 'issues'
      ? client.GET(
          '/api/v4/projects/{id}/issues/{noteable_id}/notes/{note_id}',
          init,
        )
      : client.GET(
          '/api/v4/projects/{id}/merge_requests/{noteable_id}/notes/{note_id}',
          init,
        ),
  );
  return new GitlabComment(toCommentData(data, parent.url), parent);
}

export async function createNote<P extends Parent>(parent: P, body: string) {
  const { client } = parent.project;
  const init = { params: { path: params(parent) }, body: { body } };
  const { data } = await unwrap(
    'gitlab',
    parent.noteable === 'issues'
      ? client.POST('/api/v4/projects/{id}/issues/{noteable_id}/notes', init)
      : client.POST(
          '/api/v4/projects/{id}/merge_requests/{noteable_id}/notes',
          init,
        ),
  );
  return new GitlabComment(toCommentData(data, parent.url), parent);
}
