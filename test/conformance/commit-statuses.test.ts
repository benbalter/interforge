import { describe, expect, test } from 'vitest';
import { forges } from '../support/harness.js';

describe.each(forges)('%s commit statuses', (_forge, setup) => {
  test('set and list statuses', async () => {
    const { service, ref } = setup();
    const project = await service.getProject(ref);

    const flag = await project.setCommitStatus('abc123', 'success', {
      context: 'ci/test',
      description: 'All green',
      targetUrl: 'https://ci.example.com/1',
    });
    expect(flag).toMatchObject({
      commit: 'abc123',
      state: 'success',
      context: 'ci/test',
      description: 'All green',
      url: 'https://ci.example.com/1',
    });

    await project.setCommitStatus('abc123', 'failure', { context: 'ci/lint' });
    await project.setCommitStatus('abc123', 'pending', {
      context: 'ci/deploy',
    });

    const states = (await project.getCommitStatuses('abc123'))
      .map((f) => `${f.context}=${f.state}`)
      .sort();
    expect(states).toEqual([
      'ci/deploy=pending',
      'ci/lint=failure',
      'ci/test=success',
    ]);
  });

  test("a pull request's statuses are its head commit's", async () => {
    const { service, ref } = setup();
    const project = await service.getProject(ref);
    const pr = await project.createPr('Add widgets', '', 'main', 'feature');
    await project.setCommitStatus(pr.headCommit, 'success', { context: 'ci' });

    expect((await pr.getStatuses()).map((f) => f.state)).toEqual(['success']);
  });
});
