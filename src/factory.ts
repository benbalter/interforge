import { OperationNotSupported } from './abstract/errors.js';
import type { GitProject } from './abstract/project.js';
import type { GitService } from './abstract/service.js';
import { parseGitUrl } from './parsing.js';
import { GithubService } from './services/github/service.js';
import { GitlabService } from './services/gitlab/service.js';

/**
 * Finds the service for a URL's host and fetches the project, like
 * ogr.get_project().
 */
export async function getProject(
  url: string,
  services: GitService[],
): Promise<GitProject> {
  const { hostname, namespace, repo } = parseGitUrl(url);
  const service = services.find((s) => s.hostname === hostname);
  if (!service) {
    throw new OperationNotSupported(`No service configured for ${hostname}`);
  }
  return service.getProject({ namespace, repo });
}

/**
 * Services configured from environment variables:
 *
 * - GITHUB_TOKEN (and GITHUB_SERVER_URL, set by GitHub Actions)
 * - GITLAB_TOKEN (and CI_SERVER_URL, set by GitLab CI). CI_JOB_TOKEN isn't
 *   used: it needs a different header and can only reach a few endpoints.
 */
export function servicesFromEnv(
  // `globalThis.process` so this module also loads where there's no process.
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): GitService[] {
  const services: GitService[] = [];
  if (env.GITHUB_TOKEN) {
    services.push(
      new GithubService({
        token: env.GITHUB_TOKEN,
        instanceUrl: env.GITHUB_SERVER_URL,
      }),
    );
  }
  if (env.GITLAB_TOKEN) {
    services.push(
      new GitlabService({
        token: env.GITLAB_TOKEN,
        instanceUrl: env.CI_SERVER_URL,
      }),
    );
  }
  return services;
}
