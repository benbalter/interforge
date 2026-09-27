import { parseGitUrl } from '../parsing.js';
import { NotFoundError, OperationNotSupported, type Forge } from './errors.js';
import type { GitProject } from './project.js';
import type { GitUser } from './user.js';

export interface ProjectRef {
  namespace: string;
  repo: string;
}

/** One forge instance (github.com, a GitLab host). Mirrors ogr/abstract/git_service.py. */
export abstract class GitService {
  abstract readonly forge: Forge;
  /** Web URL of the instance, e.g. `https://gitlab.com`. */
  abstract readonly instanceUrl: string;

  get hostname() {
    return new URL(this.instanceUrl).hostname;
  }

  /** Fetches the project. Throws NotFoundError if it doesn't exist or isn't visible. */
  abstract getProject(ref: ProjectRef): Promise<GitProject>;
  abstract getCurrentUser(): Promise<GitUser>;

  getProjectFromUrl(url: string): Promise<GitProject> {
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
