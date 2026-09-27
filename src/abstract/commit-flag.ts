import type { CommitStatus } from './status.js';

/** A commit status ("flag" in ogr). Mirrors ogr/abstract/commit_flag.py. */
export interface CommitFlag {
  commit: string;
  state: CommitStatus;
  context: string;
  description: string | null;
  url: string | null;
  created: Date;
}

export interface CommitFlagOptions {
  targetUrl?: string;
  description?: string;
  context?: string;
}
