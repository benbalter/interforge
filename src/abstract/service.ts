import { parseGitUrl } from '../parsing.js';
import { NotFoundError, OperationNotSupported, type Forge } from './errors.js';
import type { GitProject } from './project.js';
import type { RateLimit } from '../retry.js';
import type { GitUser } from './user.js';

/** A write that dry-run mode skipped. */
export interface DryRunAction {
  forge: Forge;
  /** The method, e.g. `createIssue` or `close`. */
  action: string;
  /** What it would have changed, e.g. `octo-org/widgets` or `octo-org/widgets#5`. */
  target: string;
  details: Record<string, unknown>;
}

/**
 * Dry-run mode, like ogr's read-only mode: reads still go to the forge, but
 * writes are skipped and recorded instead. Pass a function to be told about
 * each one as it happens.
 */
export type DryRunOption = boolean | ((action: DryRunAction) => void);

export interface ProjectRef {
  namespace: string;
  repo: string;
}

/** One forge instance (github.com, a GitLab host). Mirrors ogr/abstract/git_service.py. */
export abstract class GitService {
  abstract readonly forge: Forge;
  /** Web URL of the instance, e.g. `https://gitlab.com`. */
  abstract readonly instanceUrl: string;

  /** Skip writes and record them in `dryRunLog`. Can be changed at any time. */
  dryRun: DryRunOption = false;
  /** Writes skipped in dry-run mode, in order. */
  readonly dryRunLog: DryRunAction[] = [];
  private dryRunUser?: Promise<string>;

  /**
   * Records a write when in dry-run mode. Returns true if the caller should
   * skip it.
   */
  skipWrite(
    action: string,
    target: string,
    details: Record<string, unknown> = {},
  ) {
    if (!this.dryRun) return false;
    const entry: DryRunAction = { forge: this.forge, action, target, details };
    this.dryRunLog.push(entry);
    if (typeof this.dryRun === 'function') this.dryRun(entry);
    return true;
  }

  /** Author for dry-run stand-ins: the current user, or '' if unknown. */
  dryRunAuthor(): Promise<string> {
    this.dryRunUser ??= this.getCurrentUser().then(
      (user) => user.username,
      () => '',
    );
    return this.dryRunUser;
  }

  /** The rate limit from the most recent response that reported one. */
  rateLimit?: RateLimit;

  protected observeRateLimit = (limit: RateLimit) => {
    this.rateLimit = limit;
  };

  /** Requests left before the rate limit, or null if the forge hasn't said. */
  abstract getRateLimitRemaining(): Promise<number | null>;

  get hostname() {
    return new URL(this.instanceUrl).hostname;
  }

  /** Fetches the project. Throws NotFoundError if it doesn't exist or isn't visible. */
  abstract getProject(ref: ProjectRef): Promise<GitProject>;
  abstract getCurrentUser(): Promise<GitUser>;

  async getProjectFromUrl(url: string): Promise<GitProject> {
    const parsed = parseGitUrl(url);
    if (parsed.hostname !== this.hostname) {
      throw new OperationNotSupported(`${url} is not on ${this.hostname}`);
    }
    return this.getProject(parsed);
  }

  async projectExists(ref: ProjectRef): Promise<boolean> {
    try {
      await this.getProject(ref);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
  }
}
