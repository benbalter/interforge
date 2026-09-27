import { describe, expect, test } from 'vitest';
import { forges } from '../support/harness.js';

describe.each(forges)('%s issues', (_forge, setup) => {
  async function project(options?: Parameters<typeof setup>[0]) {
    const harness = setup(options);
    return {
      ...harness,
      project: await harness.service.getProject(harness.ref),
    };
  }

  test('createIssue and getIssue round-trip', async () => {
    const { project, projectUrl } = await project_();
    const created = await project.createIssue(
      'Widgets wobble',
      'They wobble.',
      {
        labels: ['bug', 'p1'],
        assignees: ['bob'],
      },
    );
    const issue = await project.getIssue(created.id);

    expect(issue.toJSON()).toEqual(created.toJSON());
    expect(issue).toMatchObject({
      title: 'Widgets wobble',
      description: 'They wobble.',
      status: 'open',
      author: 'alice',
      labels: ['bug', 'p1'],
      assignees: ['bob'],
      private: false,
    });
    expect(issue.url.startsWith(projectUrl)).toBe(true);
    expect(issue.created).toBeInstanceOf(Date);
  });

  test('getIssueList filters by status, labels and author', async () => {
    const { project } = await project_();
    await project.createIssue('one', '', { labels: ['bug'] });
    await project.createIssue('two', '', { labels: ['bug', 'p1'] });
    const three = await project.createIssue('three', '');
    await three.close();

    const titles = async (
      options?: Parameters<typeof project.getIssueList>[0],
    ) => (await project.getIssueList(options)).map((i) => i.title).sort();

    expect(await titles()).toEqual(['one', 'two']);
    expect(await titles({ status: 'closed' })).toEqual(['three']);
    expect(await titles({ status: 'all' })).toEqual(['one', 'three', 'two']);
    expect(await titles({ labels: ['bug', 'p1'] })).toEqual(['two']);
    expect(await titles({ author: 'alice' })).toEqual(['one', 'two']);
    expect(await titles({ author: 'bob' })).toEqual([]);
  });

  test('lists follow pagination', async () => {
    const { project, fake } = await project_();
    for (let n = 1; n <= 5; n++) await project.createIssue(`issue ${n}`, '');
    fake.pageSize = 2;

    expect(await project.getIssueList()).toHaveLength(5);
  });

  test('updating an issue', async () => {
    const { project } = await project_();
    const issue = await project.createIssue('Old title', 'Old body', {
      labels: ['bug'],
    });

    await issue.setTitle('New title');
    await issue.setDescription('New body');
    await issue.addLabel('p1');
    await issue.addAssignee('bob');
    await issue.close();
    await issue.refresh();

    expect(issue).toMatchObject({
      title: 'New title',
      description: 'New body',
      status: 'closed',
      assignees: ['bob'],
    });
    expect([...issue.labels].sort()).toEqual(['bug', 'p1']);
  });

  test('comments', async () => {
    const { project } = await project_();
    const issue = await project.createIssue('Discuss', '');

    const first = await issue.comment('First!');
    await issue.comment('Second, +1');
    await issue.comment('Third');

    const bodies = async (options?: Parameters<typeof issue.getComments>[0]) =>
      (await issue.getComments(options)).map((c) => c.body);

    expect(await bodies()).toEqual(['First!', 'Second, +1', 'Third']);
    expect(await bodies({ reverse: true })).toEqual([
      'Third',
      'Second, +1',
      'First!',
    ]);
    expect(await bodies({ filter: '\\+1' })).toEqual(['Second, +1']);
    expect(await bodies({ filter: /^T/ })).toEqual(['Third']);
    expect(await bodies({ author: 'alice' })).toHaveLength(3);
    expect(await bodies({ author: 'bob' })).toEqual([]);

    expect(first).toMatchObject({ author: 'alice', parent: issue });
    expect(first.url.startsWith(issue.url)).toBe(true);

    const fetched = await issue.getComment(first.id);
    expect(fetched.body).toBe('First!');
    await fetched.setBody('First (edited)');
    expect((await issue.getComment(first.id)).body).toBe('First (edited)');
  });

  test('missing issues throw NotFoundError', async () => {
    const { project } = await project_();
    await expect(project.getIssue(999)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
    });
  });

  // `project_` keeps the helper name from shadowing the destructured `project`.
  const project_ = project;
});
