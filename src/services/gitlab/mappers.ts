import type { CommentData } from '../../abstract/comment.js';
import type { CommitFlag } from '../../abstract/commit-flag.js';
import type { IssueData } from '../../abstract/issue.js';
import type { GitProjectData } from '../../abstract/project.js';
import type { PullRequestData } from '../../abstract/pull-request.js';
import type { CommitStatus } from '../../abstract/status.js';
import type { components } from './openapi.js';

type Schemas = components['schemas'];

export function toProjectData(
  project: Schemas['APIEntitiesProjectsWithAccessAndCatalogSetting'],
): GitProjectData {
  const namespace =
    project.namespace?.full_path ??
    project.path_with_namespace.slice(0, -(project.path.length + 1));
  return {
    namespace,
    repo: project.path,
    webUrl: project.web_url,
    description: project.description ?? '',
    defaultBranch: project.default_branch ?? null,
    // Same as ogr: only `private` counts; `internal` is visible to all users.
    isPrivate: project.visibility === 'private',
    hasIssues:
      project.issues_enabled ?? project.issues_access_level !== 'disabled',
  };
}

export function toIssueData(issue: Schemas['APIEntitiesIssue']): IssueData {
  return {
    id: issue.iid,
    title: issue.title,
    description: issue.description ?? '',
    status: issue.state === 'closed' ? 'closed' : 'open',
    url: issue.web_url,
    author: issue.author.username,
    created: new Date(issue.created_at),
    labels: issue.labels,
    assignees: issue.assignees.map((user) => user.username),
    private: issue.confidential ?? false,
  };
}

export function toPullRequestData(
  mr:
    | Schemas['APIEntitiesMergeRequest']
    | Schemas['APIEntitiesMergeRequestBasic'],
): PullRequestData {
  return {
    id: mr.iid,
    title: mr.title,
    description: mr.description ?? '',
    // `locked` is a short-lived state while a merge is in progress.
    status:
      mr.state === 'merged'
        ? 'merged'
        : mr.state === 'closed'
          ? 'closed'
          : 'open',
    url: mr.web_url,
    author: mr.author.username,
    created: new Date(mr.created_at),
    labels: mr.labels,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    headCommit: mr.sha,
  };
}

export function toCommentData(
  note: Schemas['APIEntitiesNote'],
  parentUrl: string,
): CommentData {
  return {
    id: note.id,
    body: note.body,
    author: note.author.username,
    created: new Date(note.created_at),
    edited: new Date(note.updated_at),
    // Notes have no web_url; this is the anchor GitLab's UI uses.
    url: `${parentUrl}#note_${note.id}`,
  };
}

const TO_GITLAB_STATE = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failure: 'failed',
  error: 'failed',
  canceled: 'canceled',
} as const satisfies Record<CommitStatus, string>;

export function toGitlabState(state: CommitStatus) {
  return TO_GITLAB_STATE[state];
}

const FROM_GITLAB_STATE: Record<string, CommitStatus> = {
  created: 'pending',
  waiting_for_resource: 'pending',
  preparing: 'pending',
  pending: 'pending',
  scheduled: 'pending',
  manual: 'pending',
  running: 'running',
  success: 'success',
  failed: 'failure',
  canceling: 'canceled',
  canceled: 'canceled',
  skipped: 'canceled',
};

export function toCommitFlag(
  status: Schemas['APIEntitiesCommitStatus'],
): CommitFlag {
  return {
    commit: status.sha,
    state: FROM_GITLAB_STATE[status.status] ?? 'error',
    context: status.name,
    description: status.description ?? null,
    url: status.target_url ?? null,
    created: new Date(status.created_at),
  };
}
