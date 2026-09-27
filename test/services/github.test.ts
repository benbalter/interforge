import { describe, expect, test } from 'vitest';
import { OperationNotSupported } from '../../src/abstract/errors.js';
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
