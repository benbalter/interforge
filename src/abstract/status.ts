// Mirrors ogr/abstract/status.py. String unions instead of IntEnums, so values
// read well in logs and JSON.

export const IssueStatus = {
  open: 'open',
  closed: 'closed',
  all: 'all',
} as const;
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

export const PRStatus = {
  open: 'open',
  closed: 'closed',
  merged: 'merged',
  all: 'all',
} as const;
export type PRStatus = (typeof PRStatus)[keyof typeof PRStatus];

export const CommitStatus = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failure: 'failure',
  error: 'error',
  canceled: 'canceled',
} as const;
export type CommitStatus = (typeof CommitStatus)[keyof typeof CommitStatus];
