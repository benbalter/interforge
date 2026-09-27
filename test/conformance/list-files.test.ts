import { describe, expect, test } from 'vitest';
import { NotFoundError } from '../../src/abstract/errors.js';
import { forges } from '../support/harness.js';

describe.each(forges)('%s list files', (_forge, setup) => {
  async function setupProject() {
    const harness = setup();
    const { setFile } = harness;
    setFile('README.md', '');
    setFile('LICENSE', '');
    setFile('src/index.ts', '');
    setFile('src/lib/util.ts', '');
    setFile('docs/guide.md', '');
    return {
      ...harness,
      project: await harness.service.getProject(harness.ref),
    };
  }

  const sorted = async (paths: Promise<string[]>) => (await paths).sort();

  test('top-level files only by default', async () => {
    const { project } = await setupProject();
    expect(await sorted(project.getFiles())).toEqual(['LICENSE', 'README.md']);
  });

  test('recursive lists every file, not directories', async () => {
    const { project } = await setupProject();
    expect(await sorted(project.getFiles({ recursive: true }))).toEqual([
      'LICENSE',
      'README.md',
      'docs/guide.md',
      'src/index.ts',
      'src/lib/util.ts',
    ]);
  });

  test('filterRegex, as a string or RegExp', async () => {
    const { project } = await setupProject();
    expect(
      await sorted(
        project.getFiles({ recursive: true, filterRegex: '\\.ts$' }),
      ),
    ).toEqual(['src/index.ts', 'src/lib/util.ts']);
    expect(
      await project.getFiles({ recursive: true, filterRegex: /^docs\// }),
    ).toEqual(['docs/guide.md']);
  });

  test('from a ref', async () => {
    const { project, setFile } = await setupProject();
    setFile('CHANGELOG.md', '', 'next');
    expect(await project.getFiles({ ref: 'next' })).toEqual(['CHANGELOG.md']);
  });

  test('follows pagination', async () => {
    const { project, fake, setFile } = await setupProject();
    for (let n = 0; n < 7; n++) setFile(`many/file-${n}.txt`, '');
    fake.pageSize = 3;
    expect(
      await project.getFiles({ recursive: true, filterRegex: '^many/' }),
    ).toHaveLength(7);
  });

  test('an unknown ref is not found', async () => {
    const { project } = await setupProject();
    await expect(project.getFiles({ ref: 'nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
