import { describe, expect, test } from 'vitest';
import { parseGitUrl } from '../src/parsing.js';

describe('parseGitUrl', () => {
  test.each([
    ['https://github.com/owner/repo', 'github.com', 'owner', 'repo'],
    ['https://github.com/owner/repo.git', 'github.com', 'owner', 'repo'],
    ['https://github.com/owner/repo/issues/5', 'github.com', 'owner', 'repo'],
    [
      'https://github.com/owner/repo/pull/7/files',
      'github.com',
      'owner',
      'repo',
    ],
    ['git@github.com:owner/repo.git', 'github.com', 'owner', 'repo'],
    ['github.com/owner/repo', 'github.com', 'owner', 'repo'],
    ['https://gitlab.com/group/sub/repo', 'gitlab.com', 'group/sub', 'repo'],
    [
      'https://gitlab.com/group/sub/repo/-/merge_requests/3',
      'gitlab.com',
      'group/sub',
      'repo',
    ],
    ['git@gitlab.com:group/sub/repo.git', 'gitlab.com', 'group/sub', 'repo'],
    [
      'ssh://git@gitlab.example.com:2222/group/repo.git',
      'gitlab.example.com',
      'group',
      'repo',
    ],
    ['git+ssh://git@github.com/owner/repo.git', 'github.com', 'owner', 'repo'],
    [
      'https://gitlab.example.com:8443/group/sub/repo.git',
      'gitlab.example.com',
      'group/sub',
      'repo',
    ],
    ['https://github.com/owner/repo/', 'github.com', 'owner', 'repo'],
  ])('%s', (url, hostname, namespace, repo) => {
    expect(parseGitUrl(url)).toEqual({ hostname, namespace, repo });
  });

  test.each(['https://github.com/owner', 'not a url', 'https://github.com/'])(
    'rejects %s',
    (url) => {
      expect(() => parseGitUrl(url)).toThrow();
    },
  );
});
