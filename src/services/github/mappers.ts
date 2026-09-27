import type { CommentData } from '../../abstract/comment.js';
import type { CommitFlag } from '../../abstract/commit-flag.js';
import type { IssueData } from '../../abstract/issue.js';
import type { GitProjectData } from '../../abstract/project.js';
import type { PullRequestData } from '../../abstract/pull-request.js';
import { CommitStatus } from '../../abstract/status.js';
import type { components } from './openapi.js';

type Schemas = components['schemas'];

export function toProjectData(
  repo: Schemas['full-repository'],
): GitProjectData {
  return {
    namespace: repo.owner.login,
    repo: repo.name,
    webUrl: repo.html_url,
    description: repo.description ?? '',
    defaultBranch: repo.default_branch ?? null,
    isPrivate: repo.private,
    hasIssues: repo.has_issues,
  };
}

export function toIssueData(issue: Schemas['issue']): IssueData {
  return {
    id: issue.number,
    title: issue.title,
    description: issue.body ?? '',
    status: issue.state === 'closed' ? 'closed' : 'open',
    url: issue.html_url,
    author: issue.user?.login ?? '',
    created: new Date(issue.created_at),
    labels: issue.labels
      .map((label) => (typeof label === 'string' ? label : label.name))
      .filter((name): name is string => !!name),
    assignees: (issue.assignees ?? []).map((user) => user.login),
    private: false,
  };
}

export function toPullRequestData(
  pr: Schemas['pull-request'] | Schemas['pull-request-simple'],
): PullRequestData {
  return {
    id: pr.number,
    title: pr.title,
    description: pr.body ?? '',
    status: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
    url: pr.html_url,
    author: pr.user?.login ?? '',
    created: new Date(pr.created_at),
    labels: pr.labels.map((label) => label.name),
    sourceBranch: pr.head.ref,
    targetBranch: pr.base.ref,
    headCommit: pr.head.sha,
  };
}

export function toCommentData(comment: Schemas['issue-comment']): CommentData {
  return {
    id: comment.id,
    body: comment.body ?? '',
    author: comment.user?.login ?? '',
    created: new Date(comment.created_at),
    edited: new Date(comment.updated_at),
    url: comment.html_url,
  };
}

// GitHub has four states. Map ours onto them and back.
const TO_GITHUB_STATE = {
  pending: 'pending',
  running: 'pending',
  success: 'success',
  failure: 'failure',
  error: 'error',
  canceled: 'error',
} as const satisfies Record<CommitStatus, string>;

export function toGithubState(state: CommitStatus) {
  return TO_GITHUB_STATE[state];
}

export function toCommitFlag(
  status: Schemas['status'],
  sha: string,
): CommitFlag {
  const state = status.state as keyof typeof CommitStatus;
  return {
    commit: sha,
    state: CommitStatus[state] ?? CommitStatus.error,
    context: status.context,
    description: status.description,
    url: status.target_url,
    created: new Date(status.created_at),
  };
}
