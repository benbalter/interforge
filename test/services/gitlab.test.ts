import { describe, expect, test } from 'vitest';
import { OperationNotSupported } from '../../src/abstract/errors.js';
import { gitlab } from '../support/harness.js';

describe('GitLab specifics', () => {
  test('nested groups: namespace keeps every group', async () => {
    const { service, ref } = gitlab({ path: 'a/b/c/widgets' });
    const project = await service.getProject(ref);
    expect(project.namespace).toBe('a/b/c');
    expect(project.fullRepoName).toBe('a/b/c/widgets');
  });

  test('system notes never show up as comments', async () => {
    for (const honorActivityFilter of [true, false]) {
      const { service, ref, addNote } = gitlab({ honorActivityFilter });
      const project = await service.getProject(ref);
      const issue = await project.createIssue('Discuss', '');
      await issue.comment('Hello');
      addNote('issues', issue.id, 'added ~bug label', true);
      await issue.comment('World');

      expect((await issue.getComments()).map((c) => c.body)).toEqual([
        'Hello',
        'World',
      ]);
    }
  });

  test('comment URLs point at the note anchor', async () => {
    const { service, ref } = gitlab();
    const issue = await (await service.getProject(ref)).createIssue('x', '');
    const comment = await issue.comment('hi');
    expect(comment.url).toBe(`${issue.url}#note_${comment.id}`);
  });

  test('GitLab Free drops extra assignees, which is an error', async () => {
    const { service, ref } = gitlab({ maxAssignees: 1 });
    const project = await service.getProject(ref);

    await expect(
      project.createIssue('Pair on this', '', { assignees: ['bob', 'carol'] }),
    ).rejects.toThrow(/did not assign carol/);

    const issue = await project.createIssue('Solo', '', { assignees: ['bob'] });
    await expect(issue.addAssignee('carol')).rejects.toBeInstanceOf(
      OperationNotSupported,
    );
  });

  test('Premium keeps every assignee', async () => {
    const { service, ref } = gitlab({ maxAssignees: 100 });
    const project = await service.getProject(ref);
    const issue = await project.createIssue('Pair on this', '', {
      assignees: ['bob'],
    });
    await issue.addAssignee('carol');
    expect(issue.assignees).toEqual(['bob', 'carol']);
  });

  test('unknown usernames fail before anything is created', async () => {
    const { service, ref, issues } = gitlab();
    const project = await service.getProject(ref);
    await expect(
      project.createIssue('x', '', { assignees: ['mallory'] }),
    ).rejects.toThrow(/user not found: mallory/);
    expect(issues.size).toBe(0);
  });

  test('confidential issues are private', async () => {
    const { service, ref } = gitlab();
    const project = await service.getProject(ref);
    const issue = await project.createIssue('Secret', '', { private: true });
    expect(issue.private).toBe(true);
  });

  test('failure and error both become failed on GitLab', async () => {
    const { service, ref } = gitlab();
    const project = await service.getProject(ref);
    expect((await project.setCommitStatus('abc', 'error')).state).toBe(
      'failure',
    );
    expect((await project.setCommitStatus('abc', 'running')).state).toBe(
      'running',
    );
  });
});
