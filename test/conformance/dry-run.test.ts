import { describe, expect, test } from 'vitest';
import type { DryRunAction } from '../../src/abstract/service.js';
import { forges } from '../support/harness.js';

describe.each(forges)('%s dry run', (forge, setup) => {
  async function setupProject() {
    const harness = setup();
    const project = await harness.service.getProject(harness.ref);
    return { ...harness, project };
  }

  test('creating returns stand-ins and sends nothing', async () => {
    const { service, project, fake, ref } = await setupProject();
    const seen: DryRunAction[] = [];
    service.dryRun = (action) => seen.push(action);
    fake.writes = 0;

    const issue = await project.createIssue('Preview me', 'Body', {
      labels: ['bug'],
      assignees: ['bob'],
    });
    const pr = await project.createPr('A change', 'Details', 'main', 'feature');
    const flag = await project.setCommitStatus('abc', 'success', {
      context: 'ci',
    });

    expect(fake.writes).toBe(0);
    expect(issue).toMatchObject({
      id: 0,
      title: 'Preview me',
      description: 'Body',
      status: 'open',
      author: 'alice',
      labels: ['bug'],
      assignees: ['bob'],
    });
    expect(pr).toMatchObject({
      id: 0,
      sourceBranch: 'feature',
      targetBranch: 'main',
    });
    expect(flag).toMatchObject({
      commit: 'abc',
      state: 'success',
      context: 'ci',
    });

    const fullName = `${ref.namespace}/${ref.repo}`;
    expect(seen.map((a) => `${a.action} ${a.target}`)).toEqual([
      `createIssue ${fullName}`,
      `createPr ${fullName}`,
      `setCommitStatus ${fullName}@abc`,
    ]);
    expect(seen[0]).toMatchObject({
      forge,
      details: {
        title: 'Preview me',
        body: 'Body',
        labels: ['bug'],
        assignees: ['bob'],
      },
    });
    expect(service.dryRunLog).toEqual(seen);
    expect(await project.getIssueList({ status: 'all' })).toEqual([]);
  });

  test('changes apply to the object only; the forge keeps the original', async () => {
    const { service, project, fake } = await setupProject();
    const issue = await project.createIssue('Original', 'Body', {
      labels: ['bug'],
    });
    service.dryRun = true;
    fake.writes = 0;

    await issue.setTitle('Renamed');
    await issue.setDescription('New body');
    await issue.addLabel('p1');
    await issue.addAssignee('bob');
    await issue.close();
    const comment = await issue.comment('A preview comment');
    await comment.setBody('Edited');

    expect(fake.writes).toBe(0);
    expect(issue).toMatchObject({
      title: 'Renamed',
      description: 'New body',
      labels: ['bug', 'p1'],
      assignees: ['bob'],
      status: 'closed',
    });
    expect(comment).toMatchObject({
      id: 0,
      body: 'Edited',
      author: 'alice',
      parent: issue,
    });
    expect(service.dryRunLog.map((a) => a.action)).toEqual([
      'setTitle',
      'setDescription',
      'addLabel',
      'addAssignee',
      'close',
      'comment',
      'setBody',
    ]);

    // Reads still go to the forge, which never saw the changes.
    await issue.refresh();
    expect(issue).toMatchObject({
      title: 'Original',
      status: 'open',
      labels: ['bug'],
    });
    expect(await issue.getComments()).toEqual([]);
  });

  test('pull request writes', async () => {
    const { service, project, fake } = await setupProject();
    const pr = await project.createPr('Change', '', 'main', 'feature');
    service.dryRun = true;
    fake.writes = 0;

    await pr.updateInfo({ title: 'Better change' });
    await pr.addLabel('enhancement');
    await pr.comment('LGTM');
    await pr.merge();

    expect(fake.writes).toBe(0);
    expect(pr).toMatchObject({
      title: 'Better change',
      labels: ['enhancement'],
      status: 'merged',
    });
    expect(service.dryRunLog.map((a) => a.action)).toEqual([
      'updateInfo',
      'addLabel',
      'comment',
      'merge',
    ]);
    expect(service.dryRunLog[0].details).toEqual({ title: 'Better change' });

    await pr.refresh();
    expect(pr.status).toBe('open');
  });

  test('turning dry run off sends writes again', async () => {
    const { service, project, fake } = await setupProject();
    service.dryRun = true;
    await project.createIssue('Skipped', '');
    service.dryRun = false;
    const real = await project.createIssue('Sent', '');

    expect(fake.writes).toBe(1);
    expect(real.id).toBeGreaterThan(0);
  });
});

test('the dryRun option', async () => {
  const { GithubService } =
    await import('../../src/services/github/service.js');
  expect(new GithubService({ dryRun: true }).dryRun).toBe(true);
  expect(new GithubService().dryRun).toBe(false);
});
