/**
 * Moves the pinned OpenAPI descriptions in spec/<forge>/config.json to the
 * latest upstream versions:
 *
 * - GitHub: the latest commit of github/rest-api-description, and its newest
 *   dated API version (updating GITHUB_API_VERSION to match)
 * - GitLab: the newest stable release tag of gitlab-org/gitlab
 *
 * Run `npm run specs:update` afterwards to regenerate from the new pins.
 * Set GITHUB_TOKEN to avoid GitHub's anonymous rate limit.
 */
import { readFile, writeFile } from 'node:fs/promises';

async function getJson<T>(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return (await response.json()) as T;
}

async function updateConfig(forge: string, source: string, extra = {}) {
  const path = `spec/${forge}/config.json`;
  const config = JSON.parse(await readFile(path, 'utf8'));
  const changed = config.source !== source;
  Object.assign(config, { source }, extra);
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  console.log(`${forge}: ${changed ? `now ${source}` : 'already latest'}`);
}

async function bumpGithub() {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN && {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    }),
  };
  const api = 'https://api.github.com/repos/github/rest-api-description';
  const { sha } = await getJson<{ sha: string }>(
    `${api}/commits/main`,
    headers,
  );
  const files = await getJson<{ name: string }[]>(
    `${api}/contents/descriptions/api.github.com?ref=${sha}`,
    headers,
  );
  const versions = files
    .map(
      (f) => /^api\.github\.com\.(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name)?.[1],
    )
    .filter((v): v is string => !!v)
    .sort();
  const apiVersion = versions.at(-1);
  if (!apiVersion) throw new Error('No dated GitHub API versions found');

  await updateConfig(
    'github',
    `https://raw.githubusercontent.com/github/rest-api-description/${sha}/descriptions/api.github.com/api.github.com.${apiVersion}.json`,
    { apiVersion },
  );

  const clientPath = 'src/services/github/client.ts';
  const client = await readFile(clientPath, 'utf8');
  const pattern = /export const GITHUB_API_VERSION = '[\d-]+';/;
  if (!pattern.test(client))
    throw new Error(`GITHUB_API_VERSION not found in ${clientPath}`);
  await writeFile(
    clientPath,
    client.replace(
      pattern,
      `export const GITHUB_API_VERSION = '${apiVersion}';`,
    ),
  );
}

async function bumpGitlab() {
  const tags = await getJson<{ name: string }[]>(
    'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab/repository/tags' +
      '?order_by=version&sort=desc&search=%5Ev&per_page=50',
  );
  const tag = tags
    .map((t) => t.name)
    .find((n) => /^v\d+\.\d+\.\d+-ee$/.test(n));
  if (!tag) throw new Error('No stable GitLab release tag found');

  const source = `https://gitlab.com/gitlab-org/gitlab/-/raw/${tag}/doc/api/openapi/openapi_v3.yaml`;
  const head = await fetch(source, { method: 'HEAD' });
  if (!head.ok) throw new Error(`${head.status}: ${source}`);
  await updateConfig('gitlab', source);
}

await bumpGithub();
await bumpGitlab();
