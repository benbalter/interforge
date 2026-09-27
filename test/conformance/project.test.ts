import { describe, expect, test } from 'vitest';
import {
  IssueTrackerDisabled,
  NotFoundError,
} from '../../src/abstract/errors.js';
import { forges } from '../support/harness.js';

describe.each(forges)('%s project', (_forge, setup) => {
  test('getProject hydrates the project', async () => {
    const { service, ref, projectUrl } = setup();
    const project = await service.getProject(ref);

    expect(project.namespace).toBe(ref.namespace);
    expect(project.repo).toBe(ref.repo);
    expect(project.fullRepoName).toBe(`${ref.namespace}/${ref.repo}`);
    expect(project.webUrl).toBe(projectUrl);
    expect(project.defaultBranch).toBe('main');
    expect(project.isPrivate).toBe(true);
    expect(project.hasIssues).toBe(true);
    expect(project.toJSON()).toMatchObject({ repo: ref.repo });
  });

  test('getProjectFromUrl accepts web URLs', async () => {
    const { service, ref, projectUrl } = setup();
    const project = await service.getProjectFromUrl(`${projectUrl}.git`);
    expect(project.fullRepoName).toBe(`${ref.namespace}/${ref.repo}`);
    await expect(
      service.getProjectFromUrl('https://example.org/a/b'),
    ).rejects.toThrow(/not on/);
  });

  test('missing projects throw NotFoundError', async () => {
    const { service, ref, forge } = setup();
    const missing = { ...ref, repo: 'nope' };

    await expect(service.getProject(missing)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      forge,
    });
    await expect(service.getProject(missing)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await service.projectExists(missing)).toBe(false);
    expect(await service.projectExists(ref)).toBe(true);
  });

  test('getCurrentUser', async () => {
    const { service } = setup();
    expect(await service.getCurrentUser()).toMatchObject({ username: 'alice' });
  });

  test('issue methods throw IssueTrackerDisabled when issues are off', async () => {
    const { service, ref } = setup({ hasIssues: false });
    const project = await service.getProject(ref);

    expect(project.hasIssues).toBe(false);
    await expect(project.getIssueList()).rejects.toBeInstanceOf(
      IssueTrackerDisabled,
    );
    await expect(project.createIssue('x', 'y')).rejects.toBeInstanceOf(
      IssueTrackerDisabled,
    );
  });
});
