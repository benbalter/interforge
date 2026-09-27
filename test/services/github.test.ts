import { describe, expect, test } from 'vitest';
import { OperationNotSupported } from '../../src/abstract/errors.js';
import { GITHUB_API_VERSION } from '../../src/services/github/client.js';
import { GithubService } from '../../src/services/github/service.js';
import { github } from '../support/harness.js';

describe('GitHub specifics', () => {
  test('issue lists leave out pull requests', async () => {
    const { service, ref } = github();
    const project = await service.getProject(ref);
    await project.createIssue('An issue', '');
    const pr = await project.createPr('A pull request', '', 'main', 'feature');

    expect(
      (await project.getIssueList({ status: 'all' })).map((i) => i.title),
    ).toEqual(['An issue']);
    await expect(project.getIssue(pr.id)).rejects.toBeInstanceOf(
      OperationNotSupported,
    );
  });

  test('private (confidential) issues are not supported', async () => {
    const { service, ref } = github();
    const project = await service.getProject(ref);
    await expect(
      project.createIssue('Secret', '', { private: true }),
    ).rejects.toBeInstanceOf(OperationNotSupported);
  });

  test('GitHub has no running or canceled states, so they map to pending and error', async () => {
    const { service, ref } = github();
    const project = await service.getProject(ref);
    expect((await project.setCommitStatus('abc', 'running')).state).toBe(
      'pending',
    );
    expect((await project.setCommitStatus('abc', 'canceled')).state).toBe(
      'error',
    );
  });

  test('GitHub Enterprise Server uses <instance>/api/v3', () => {
    const service = new GithubService({
      instanceUrl: 'https://ghe.example.com/',
    });
    expect(service.instanceUrl).toBe('https://ghe.example.com');
    expect(service.hostname).toBe('ghe.example.com');
  });
});

describe('GitHub file contents', () => {
  test('files over 1 MB are fetched with the raw media type', async () => {
    const { service, ref, setFile } = github({ largeFileBytes: 10 });
    setFile('big.txt', 'more than ten bytes');
    const project = await service.getProject(ref);
    expect(await project.getFileContent('big.txt')).toBe('more than ten bytes');
  });
});

describe('GitHub list files', () => {
  test('a truncated recursive tree is walked one level at a time', async () => {
    const { service, ref, setFile, fake } = github({ treeLimit: 2 });
    setFile('a.txt', '');
    setFile('dir/b.txt', '');
    setFile('dir/sub/c.txt', '');
    const project = await service.getProject(ref);
    fake.requests = 0;

    expect((await project.getFiles({ recursive: true })).sort()).toEqual([
      'a.txt',
      'dir/b.txt',
      'dir/sub/c.txt',
    ]);
    expect(fake.requests).toBe(4); // truncated recursive tree, then root, dir, dir/sub
  });
});

describe('GitHub API version', () => {
  test('sent with every request, and configurable', async () => {
    const { server } = await import('../support/harness.js');
    const { http, HttpResponse } = await import('msw');
    const versions: (string | null)[] = [];
    server.use(
      http.get('https://ghe.example.com/api/v3/user', ({ request }) => {
        versions.push(request.headers.get('x-github-api-version'));
        return HttpResponse.json({
          login: 'alice',
          html_url: 'https://ghe.example.com/alice',
        });
      }),
    );
    const instanceUrl = 'https://ghe.example.com';
    await new GithubService({ instanceUrl }).getCurrentUser();
    await new GithubService({
      instanceUrl,
      apiVersion: '2022-11-28',
    }).getCurrentUser();

    expect(versions).toEqual([GITHUB_API_VERSION, '2022-11-28']);
  });
});
