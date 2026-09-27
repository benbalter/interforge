import { describe, expect, test } from 'vitest';
import { forges } from '../support/harness.js';

describe.each(forges)('%s pull requests', (_forge, setup) => {
  async function setupProject() {
    const harness = setup();
    return {
      ...harness,
      project: await harness.service.getProject(harness.ref),
    };
  }

  test('createPr and getPr round-trip', async () => {
    const { project, projectUrl } = await setupProject();
    const created = await project.createPr(
      'Add widgets',
      'Adds them.',
      'main',
      'feature',
    );
    const pr = await project.getPr(created.id);

    expect(pr.toJSON()).toEqual(created.toJSON());
    expect(pr).toMatchObject({
      title: 'Add widgets',
      description: 'Adds them.',
      status: 'open',
      author: 'alice',
      sourceBranch: 'feature',
      targetBranch: 'main',
      headCommit: 'sha-feature',
      labels: [],
    });
    expect(pr.url.startsWith(projectUrl)).toBe(true);
  });

  test('updating, commenting and labeling', async () => {
    const { project } = await setupProject();
    const pr = await project.createPr('Draft', '', 'main', 'feature');

    await pr.updateInfo({ title: 'Ready', description: 'Now with tests' });
    await pr.addLabel('enhancement');
    await pr.comment('LGTM');
    await pr.refresh();

    expect(pr).toMatchObject({
      title: 'Ready',
      description: 'Now with tests',
      labels: ['enhancement'],
    });
    const comments = await pr.getComments();
    expect(comments.map((c) => c.body)).toEqual(['LGTM']);
    expect(comments[0].parent).toBe(pr);
    expect((await pr.getComment(comments[0].id)).body).toBe('LGTM');
  });

  test('merge, close and list by status', async () => {
    const { project } = await setupProject();
    const merged = await project.createPr('Merge me', '', 'main', 'a');
    const closed = await project.createPr('Close me', '', 'main', 'b');
    await project.createPr('Leave me', '', 'main', 'c');

    await merged.merge();
    await closed.close();
    expect(merged.status).toBe('merged');
    expect(closed.status).toBe('closed');

    const titles = async (status?: 'open' | 'closed' | 'merged' | 'all') =>
      (await project.getPrList({ status })).map((p) => p.title).sort();

    expect(await titles()).toEqual(['Leave me']);
    expect(await titles('merged')).toEqual(['Merge me']);
    expect(await titles('all')).toEqual(['Close me', 'Leave me', 'Merge me']);
  });
});
