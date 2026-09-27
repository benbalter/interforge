import { describe, expect, test } from 'vitest';
import { getProject, servicesFromEnv } from '../src/factory.js';
import { GithubService } from '../src/services/github/service.js';
import { GitlabService } from '../src/services/gitlab/service.js';
import { github, gitlab } from './support/harness.js';

describe('getProject', () => {
  test('picks the service for the URL host', async () => {
    const gh = github();
    const gl = gitlab();
    const services = [gh.service, gl.service];

    expect(
      (await getProject(`${gh.projectUrl}/issues/1`, services)).fullRepoName,
    ).toBe('octo-org/widgets');
    expect(
      (await getProject(`${gl.projectUrl}.git`, services)).fullRepoName,
    ).toBe('octo-org/platform/widgets');
    await expect(
      getProject('https://bitbucket.org/a/b', services),
    ).rejects.toThrow(/No service configured for bitbucket.org/);
    await expect(getProject('not a url', services)).rejects.toThrow();
  });
});

describe('servicesFromEnv', () => {
  test('configures services from tokens', () => {
    const services = servicesFromEnv({
      GITHUB_TOKEN: 'gh',
      GITLAB_TOKEN: 'gl',
      CI_SERVER_URL: 'https://gitlab.example.com',
    });
    expect(services).toHaveLength(2);
    expect(services[0]).toBeInstanceOf(GithubService);
    expect(services[1]).toBeInstanceOf(GitlabService);
    expect(services[1].hostname).toBe('gitlab.example.com');
  });

  test('needs a token', () => {
    expect(servicesFromEnv({})).toEqual([]);
  });
});
