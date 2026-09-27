import { describe, expect, test } from 'vitest';
import { ForgeError, NotFoundError } from '../../src/abstract/errors.js';
import { forges } from '../support/harness.js';

describe.each(forges)('%s file contents', (_forge, setup) => {
  async function setupProject() {
    const harness = setup();
    return {
      ...harness,
      project: await harness.service.getProject(harness.ref),
    };
  }

  test('reads files from the default branch', async () => {
    const { project, setFile } = await setupProject();
    setFile('README.md', '# Widgets\n');
    setFile('docs/guide/intro.md', 'Nested ✓ ünïcödé\n');

    expect(await project.getFileContent('README.md')).toBe('# Widgets\n');
    expect(await project.getFileContent('docs/guide/intro.md')).toBe(
      'Nested ✓ ünïcödé\n',
    );
  });

  test('reads files from a ref', async () => {
    const { project, setFile } = await setupProject();
    setFile('VERSION', '1.0\n');
    setFile('VERSION', '2.0\n', 'next');

    expect(await project.getFileContent('VERSION', 'next')).toBe('2.0\n');
    expect(await project.getFileContent('VERSION')).toBe('1.0\n');
  });

  test('long files decode across wrapped base64 lines', async () => {
    const { project, setFile } = await setupProject();
    const long = 'line of text\n'.repeat(500);
    setFile('long.txt', long);
    expect(await project.getFileContent('long.txt')).toBe(long);
  });

  test('missing files throw NotFoundError', async () => {
    const { project } = await setupProject();
    await expect(project.getFileContent('nope.txt')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test('directories are not files', async () => {
    const { project, setFile } = await setupProject();
    setFile('docs/a.md', 'a');
    await expect(project.getFileContent('docs')).rejects.toBeInstanceOf(
      ForgeError,
    );
  });
});
