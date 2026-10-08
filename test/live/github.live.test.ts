/**
 * Live GitHub tests against a scratch repository. Opt in with:
 *
 *   INTERFORGE_GITHUB_TOKEN=… INTERFORGE_GITHUB_REPO=owner/repo npm run test:live
 *
 * The token needs Issues, Pull requests, Contents and Commit statuses (read
 * and write) on that repository. Everything created is closed or deleted
 * afterwards; merged pull requests and their commits remain.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { GitProject } from '../../src/abstract/project.js';
import { GithubService } from '../../src/services/github/service.js';
import { requireEnv, specCheckingFetch } from '../support/live.js';

const token = process.env.INTERFORGE_GITHUB_TOKEN;
const repoName = process.env.INTERFORGE_GITHUB_REPO;

describe.skipIf(!token || !repoName)('live GitHub', () => {
  const [owner, repo] = (repoName ?? '/').split('/');
  const run = `interforge-live-${Date.now()}`;
  const branch = `${run}-branch`;
  const label = 'interforge-test';
  const checked = specCheckingFetch('github');
  let service: GithubService;
  let project: GitProject;
  let login: string;
  const createdIssues: number[] = [];

  /** GitHub's list endpoints can lag a write by a few seconds. */
  async function eventually<T>(
    check: () => Promise<T>,
    timeout = 20_000,
  ): Promise<T> {
    const start = Date.now();
    for (;;) {
      try {
        return await check();
      } catch (error) {
        if (Date.now() - start > timeout) throw error;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  /** Test setup the library doesn't do itself: branches and files. */
  async function github(method: string, path: string, body?: unknown) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${requireEnv('INTERFORGE_GITHUB_TOKEN')}`,
          Accept: 'application/vnd.github+json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (!response.ok)
      throw new Error(
        `${method} ${path}: ${response.status} ${await response.text()}`,
      );
    return response.status === 204 ? undefined : response.json();
  }

  beforeAll(async () => {
    service = new GithubService({ token, fetch: checked.fetch });
    project = await service.getProject({ namespace: owner, repo });
    login = (await service.getCurrentUser()).username;

    const main = await github('GET', `/git/ref/heads/${project.defaultBranch}`);
    await github('POST', '/git/refs', {
      ref: `refs/heads/${branch}`,
      sha: main.object.sha,
    });
    for (const [path, content] of [
      [`${run}/README.md`, `# ${run}\n\nünïcödé ✓\n`],
      [`${run}/nested/deep.txt`, 'deep\n'],
    ]) {
      await github('PUT', `/contents/${path}`, {
        message: `interforge live test: ${path}`,
        content: Buffer.from(content).toString('base64'),
        branch,
      });
    }
  }, 60_000);

  afterAll(async () => {
    for (const id of createdIssues) {
      await project
        .getIssue(id)
        .then((i) => i.close())
        .catch(() => {});
    }
    await github('DELETE', `/git/refs/heads/${branch}`).catch(() => {});

    console.log(
      `\nGitHub responses checked against the spec: ${checked.violations.length} mismatches` +
        (checked.unmatched.length
          ? `; unmatched requests: ${[...new Set(checked.unmatched)].join(', ')}`
          : ''),
    );
    for (const v of new Set(checked.violations))
      console.log(`  ${v.replace(/\n/g, '\n  ')}`);
  }, 60_000);

  test('project and user', async () => {
    expect(project.fullRepoName).toBe(repoName);
    expect(project.isPrivate).toBe(true);
    expect(login).toBeTruthy();
    expect(await service.getRateLimitRemaining()).toBeGreaterThan(0);
  });

  test('issue lifecycle', async () => {
    const issue = await project.createIssue(
      `${run} issue`,
      'Created by a live test.',
      {
        labels: [label],
        assignees: [login],
      },
    );
    createdIssues.push(issue.id);
    expect(issue).toMatchObject({
      status: 'open',
      labels: [label],
      assignees: [login],
      author: login,
    });

    const fetched = await project.getIssue(issue.id);
    expect(fetched.toJSON()).toEqual(issue.toJSON());

    const first = await issue.comment('First comment');
    await issue.comment('Second comment');
    expect((await issue.getComments()).map((c) => c.body)).toEqual([
      'First comment',
      'Second comment',
    ]);
    expect((await issue.getComments({ reverse: true, limit: 1 }))[0].body).toBe(
      'Second comment',
    );
    await first.setBody('First comment (edited)');
    expect((await issue.getComment(first.id)).body).toBe(
      'First comment (edited)',
    );

    await issue.addLabel('interforge-extra');
    await issue.setTitle(`${run} issue (renamed)`);
    await issue.setDescription('Updated by a live test.');
    await issue.close();
    await issue.refresh();
    expect(issue).toMatchObject({
      status: 'closed',
      title: `${run} issue (renamed)`,
    });
    expect([...issue.labels].sort()).toEqual(['interforge-extra', label]);

    await eventually(async () => {
      const closed = await project.getIssueList({
        status: 'closed',
        labels: [label],
        limit: 20,
      });
      expect(closed.map((i) => i.id)).toContain(issue.id);
    });
  }, 60_000);

  test('files on a branch', async () => {
    expect(await project.getFileContent(`${run}/README.md`, branch)).toBe(
      `# ${run}\n\nünïcödé ✓\n`,
    );
    const files = await project.getFiles({
      ref: branch,
      recursive: true,
      filterRegex: `^${run}/`,
    });
    expect(files.sort()).toEqual([
      `${run}/README.md`,
      `${run}/nested/deep.txt`,
    ]);
  }, 60_000);

  test('pull request lifecycle', async () => {
    const pr = await project.createPr(
      `${run} PR`,
      'Opened by a live test.',
      project.defaultBranch!,
      branch,
    );
    expect(pr).toMatchObject({
      status: 'open',
      sourceBranch: branch,
      author: login,
    });

    await pr.comment('PR comment');
    await pr.addLabel(label);
    await pr.updateInfo({ title: `${run} PR (renamed)` });
    await project.setCommitStatus(pr.headCommit, 'success', {
      context: 'interforge/live',
      description: 'Live test',
      targetUrl: 'https://example.com/ci',
    });
    await pr.refresh();
    expect(pr).toMatchObject({ title: `${run} PR (renamed)`, labels: [label] });
    expect((await pr.getComments()).map((c) => c.body)).toEqual(['PR comment']);
    expect(await pr.getStatuses()).toMatchObject([
      {
        context: 'interforge/live',
        state: 'success',
        url: 'https://example.com/ci',
      },
    ]);
    await eventually(async () =>
      expect(
        (await project.getPrList({ limit: 50 })).map((p) => p.id),
      ).toContain(pr.id),
    );

    await pr.merge();
    expect(pr.status).toBe('merged');
    await eventually(async () => {
      const merged = await project.getPrList({ status: 'merged', limit: 50 });
      expect(merged.map((p) => p.id)).toContain(pr.id);
    });
  }, 90_000);

  test('dry run sends nothing', async () => {
    const before = (
      await project.getIssueList({ status: 'all', labels: [label] })
    ).length;
    service.dryRun = true;
    try {
      const issue = await project.createIssue(`${run} dry run`, '');
      expect(issue.id).toBe(0);
      expect(service.dryRunLog.at(-1)).toMatchObject({ action: 'createIssue' });
    } finally {
      service.dryRun = false;
    }
    expect(
      (await project.getIssueList({ status: 'all', labels: [label] })).length,
    ).toBe(before);
  }, 60_000);
});
