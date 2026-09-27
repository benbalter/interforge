import gitUrlParse from 'git-url-parse';
import { ForgeError } from './abstract/errors.js';

export interface ParsedGitUrl {
  hostname: string;
  /** Owner or group path. May be nested on GitLab (`group/subgroup`). */
  namespace: string;
  repo: string;
}

// Path segments that start a GitHub sub-page (…/owner/repo/pull/7/files).
// git-url-parse knows some, but reads the rest as part of the repo path.
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
 * spirit of ogr/parsing.py, using git-url-parse:
 *
 *   https://github.com/owner/repo/issues/5
 *   https://gitlab.com/group/sub/repo/-/merge_requests/3
 *   git@gitlab.com:group/sub/repo.git
 *   ssh://git@host:2222/owner/repo.git
 */
export function parseGitUrl(url: string): ParsedGitUrl {
  // git-url-parse needs a scheme, unless it's the scp-like SSH form.
  const withScheme =
    /^[\w+.-]+:\/\//.test(url) || /^[\w.-]+@[\w.-]+:/.test(url)
      ? url
      : `https://${url}`;

  let parsed: ReturnType<typeof gitUrlParse>;
  try {
    parsed = gitUrlParse(withScheme);
  } catch {
    throw new ForgeError(`Can't parse git URL: ${url}`);
  }

  let segments = parsed.full_name.split('/').filter(Boolean);
  if (segments.length > 2 && GITHUB_ROUTES.has(segments[2])) {
    segments = segments.slice(0, 2);
  }
  if (!parsed.resource || segments.length < 2) {
    throw new ForgeError(`Can't find a project in git URL: ${url}`);
  }

  return {
    hostname: parsed.resource,
    namespace: segments.slice(0, -1).join('/'),
    repo: segments[segments.length - 1],
  };
}
