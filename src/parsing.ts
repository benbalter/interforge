import { ForgeError } from './abstract/errors.js';

export interface ParsedGitUrl {
  hostname: string;
  /** Owner or group path. May be nested on GitLab (`group/subgroup`). */
  namespace: string;
  repo: string;
}

// Path segments that start a GitHub sub-page (…/owner/repo/issues/5).
const GITHUB_ROUTES = new Set([
  'issues',
  'pull',
  'pulls',
  'tree',
  'blob',
  'commit',
  'commits',
  'actions',
  'releases',
  'wiki',
  'discussions',
]);

/**
 * Parses web, HTTPS clone and SSH clone URLs into a project reference, in the
 * spirit of ogr/parsing.py:
 *
 *   https://github.com/owner/repo/issues/5
 *   https://gitlab.com/group/sub/repo/-/merge_requests/3
 *   git@gitlab.com:group/sub/repo.git
 *   ssh://git@host:2222/owner/repo.git
 */
export function parseGitUrl(url: string): ParsedGitUrl {
  let hostname: string;
  let path: string;

  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(url);
  if (scp) {
    [, hostname, path] = scp;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url.includes('://') ? url : `https://${url}`);
    } catch {
      throw new ForgeError(`Can't parse git URL: ${url}`);
    }
    hostname = parsed.hostname;
    path = parsed.pathname;
  }

  let segments = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter(Boolean);

  const gitlabSeparator = segments.indexOf('-');
  if (gitlabSeparator >= 0) {
    segments = segments.slice(0, gitlabSeparator);
  } else if (segments.length > 2 && GITHUB_ROUTES.has(segments[2])) {
    segments = segments.slice(0, 2);
  }

  if (segments.length < 2) {
    throw new ForgeError(`Can't find a project in git URL: ${url}`);
  }

  return {
    hostname,
    namespace: segments.slice(0, -1).join('/'),
    repo: segments[segments.length - 1],
  };
}
