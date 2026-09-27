import { describe, expect, test } from 'vitest';
import { forges } from '../support/harness.js';

describe.each(forges)('%s lazy iteration and limits', (_forge, setup) => {
  async function setupProject(issues = 5) {
    const harness = setup();
    const project = await harness.service.getProject(harness.ref);
    for (let n = 1; n <= issues; n++)
      await project.createIssue(`issue ${n}`, '');
    harness.fake.urls.length = 0;
    return { ...harness, project };
  }

  const listRequests = (urls: URL[]) =>
    urls.filter((u) => u.searchParams.has('per_page'));

  test('a limit asks for only that many', async () => {
    const { project, fake } = await setupProject();
    const issues = await project.getIssueList({ limit: 2 });

    expect(issues).toHaveLength(2);
    const requests = listRequests(fake.urls);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('per_page')).toBe('2');
  });

  test('a limit of 0 makes no request', async () => {
    const { project, fake } = await setupProject();
    expect(await project.getIssueList({ limit: 0 })).toEqual([]);
    expect(listRequests(fake.urls)).toEqual([]);
  });

  test('breaking out of iteration stops fetching pages', async () => {
    const { project, fake } = await setupProject(6);
    fake.pageSize = 2;

    const seen: string[] = [];
    for await (const issue of project.iterateIssues()) {
      seen.push(issue.title);
      if (seen.length === 3) break;
    }

    expect(seen).toHaveLength(3);
    expect(listRequests(fake.urls)).toHaveLength(2); // of 3 pages
  });

  test('limits on pull requests and commit statuses', async () => {
    const { project } = await setupProject(0);
    await project.createPr('one', '', 'main', 'a');
    await project.createPr('two', '', 'main', 'b');
    await project.setCommitStatus('abc', 'success', { context: 'a' });
    await project.setCommitStatus('abc', 'success', { context: 'b' });

    expect(await project.getPrList({ limit: 1 })).toHaveLength(1);
    expect(await project.getCommitStatuses('abc', { limit: 1 })).toHaveLength(
      1,
    );
    expect(await project.getCommitStatuses('abc')).toHaveLength(2);
  });

  test('comment limits: oldest first, or newest with reverse', async () => {
    const { project } = await setupProject(0);
    const issue = await project.createIssue('Discuss', '');
    for (const body of ['one', 'two', 'three', 'four'])
      await issue.comment(body);

    const bodies = async (options: Parameters<typeof issue.getComments>[0]) =>
      (await issue.getComments(options)).map((c) => c.body);

    expect(await bodies({ limit: 2 })).toEqual(['one', 'two']);
    expect(await bodies({ reverse: true, limit: 2 })).toEqual([
      'four',
      'three',
    ]);
    expect(await bodies({ filter: /o/, limit: 2 })).toEqual(['one', 'two']);

    const streamed: string[] = [];
    for await (const comment of issue.iterateComments())
      streamed.push(comment.body);
    expect(streamed).toEqual(['one', 'two', 'three', 'four']);
  });
});
