import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import type { Forge } from '../../src/abstract/errors.js';
import type { GitService, ProjectRef } from '../../src/abstract/service.js';
import { GithubService } from '../../src/services/github/service.js';
import { GitlabService } from '../../src/services/gitlab/service.js';
import type { AnyFakeForge } from './fake.js';
import { fakeGithub } from './fake-github.js';
import { fakeGitlab } from './fake-gitlab.js';

export const server = setupServer();
const active: AnyFakeForge[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  // Every request and response a fake handled must match the OpenAPI description.
  for (const fake of active.splice(0)) expect(fake.violations).toEqual([]);
  server.resetHandlers();
});
afterAll(() => server.close());

export interface Harness {
  forge: Forge;
  service: GitService;
  ref: ProjectRef;
  projectUrl: string;
  fake: AnyFakeForge;
  setFile: (path: string, content: string, ref?: string) => void;
}

interface CommonOptions {
  hasIssues?: boolean;
}

function use(fake: AnyFakeForge) {
  active.push(fake);
  server.use(...fake.handlers);
}

// No backoff in tests. Rate-limit tests use `Retry-After: 0`.
const retry = { baseDelay: 0 };

export function github(options: Parameters<typeof fakeGithub>[0] = {}) {
  const gh = fakeGithub(options);
  use(gh.fake);
  return {
    ...gh,
    forge: 'github' as const,
    service: new GithubService({ token: 'test-token', retry }),
    ref: {
      namespace: options.owner ?? 'octo-org',
      repo: options.repo ?? 'widgets',
    },
    projectUrl: gh.repoUrl,
  };
}

export function gitlab(options: Parameters<typeof fakeGitlab>[0] = {}) {
  const gl = fakeGitlab(options);
  use(gl.fake);
  const [repo, ...namespace] = (options.path ?? 'octo-org/platform/widgets')
    .split('/')
    .reverse();
  return {
    ...gl,
    forge: 'gitlab' as const,
    service: new GitlabService({
      token: 'test-token',
      instanceUrl: options.instanceUrl ?? 'https://gitlab.example.com',
      retry,
    }),
    ref: { namespace: namespace.reverse().join('/'), repo },
    projectUrl: gl.webUrl,
  };
}

/** One entry per forge, for suites that must behave the same everywhere. */
export const forges: [Forge, (options?: CommonOptions) => Harness][] = [
  ['github', (options) => github(options)],
  ['gitlab', (options) => gitlab(options)],
];
