import type { paths } from '../../src/services/github/openapi.js';
import { FakeForge, type Json } from './fake.js';
import { example } from './openapi.js';

const API = 'https://api.github.com';
const WEB = 'https://github.com';

interface Options {
  owner?: string;
  repo?: string;
  hasIssues?: boolean;
  viewer?: string;
  /** GitHub leaves `content` empty for files over 1 MB. */
  largeFileBytes?: number;
  /** Recursive trees with more entries than this come back truncated. */
  treeLimit?: number;
}

/**
 * A small stateful GitHub, built from the examples in GitHub's own OpenAPI
 * description. Issues and pull requests share one number sequence, and pull
 * request comments live in the issue comments API, as on GitHub.
 */
export function fakeGithub({
  owner = 'octo-org',
  repo = 'widgets',
  hasIssues = true,
  viewer = 'alice',
  largeFileBytes = 1024 * 1024,
  treeLimit = 100_000,
}: Options = {}) {
  const fake = new FakeForge<paths>('github', API);
  const issues = new Map<number, Json>(); // includes PRs, as GitHub does
  const pulls = new Map<number, Json>();
  const comments = new Map<number, Json & { issue_number: number }>();
  const statuses = new Map<string, Json[]>();
  const files = new Map<string, string>(); // `${ref}:${path}` -> content
  const setFile = (path: string, content: string, ref = 'main') =>
    files.set(`${ref}:${path}`, content);
  let nextNumber = 1;
  let nextId = 1000;
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const now = () => new Date((clock += 60_000)).toISOString();

  const user = (login: string) => ({
    ...(example<Json>('github', 'issue').user as Json),
    login,
    html_url: `${WEB}/${login}`,
  });
  const label = (name: string) => ({ id: nextId++, name, color: 'ededed' });
  const repoUrl = `${WEB}/${owner}/${repo}`;

  function newIssue(fields: {
    title: string;
    body?: string | null;
    labels?: string[];
    assignees?: string[];
  }) {
    const number = nextNumber++;
    const issue = {
      ...example<Json>('github', 'issue'),
      id: nextId++,
      number,
      title: fields.title,
      body: fields.body ?? null,
      state: 'open',
      html_url: `${repoUrl}/issues/${number}`,
      user: user(viewer),
      labels: (fields.labels ?? []).map(label),
      assignees: (fields.assignees ?? []).map(user),
      assignee: null,
      pull_request: undefined,
      created_at: now(),
      updated_at: now(),
      closed_at: null,
      comments: 0,
    };
    issues.set(number, issue);
    return issue;
  }

  function newPull(fields: {
    title: string;
    body?: string | null;
    head: string;
    base: string;
  }) {
    const issue = newIssue(fields);
    const number = issue.number;
    issue.pull_request = {
      url: `${API}/repos/${owner}/${repo}/pulls/${number}`,
      html_url: `${repoUrl}/pull/${number}`,
      diff_url: `${repoUrl}/pull/${number}.diff`,
      patch_url: `${repoUrl}/pull/${number}.patch`,
    } as never;
    const template = example<Json>('github', 'pull-request');
    const pull = {
      ...template,
      id: nextId++,
      number,
      title: fields.title,
      body: fields.body ?? null,
      state: 'open',
      merged: false,
      merged_at: null,
      html_url: `${repoUrl}/pull/${number}`,
      user: user(viewer),
      labels: [],
      requested_teams: [],
      head: {
        ...(template.head as Json),
        ref: fields.head,
        sha: `sha-${fields.head}`,
      },
      base: { ...(template.base as Json), ref: fields.base },
      created_at: issue.created_at,
    };
    pulls.set(number, pull);
    return pull;
  }

  // Label objects in PR responses need fields that GitHub's own example lacks.
  const withLabels = (pull: Json) => ({
    ...pull,
    labels: (issues.get(pull.number as number)!.labels as Json[]).map((l) => ({
      ...example<Json[]>('github', 'label-items')[0],
      ...l,
      archived_at: null,
      archived_by: null,
    })),
  });

  const repository = () => ({
    ...example<Json>('github', 'full-repository-default-response'),
    name: repo,
    full_name: `${owner}/${repo}`,
    owner: { ...user(owner), type: 'Organization' },
    html_url: repoUrl,
    description: 'Widgets, but better',
    private: true,
    has_issues: hasIssues,
    default_branch: 'main',
    language: null,
    parent: undefined,
    source: undefined,
  });

  const isRepo = (p: Record<string, string>) =>
    p.owner === owner && p.repo === repo;

  fake.route('GET /rate_limit', () => {
    const body = example<Json>('github', 'rate-limit-overview');
    (body.resources as Json).core = {
      ...((body.resources as Json).core as Json),
      remaining: fake.rateLimit?.remaining ?? 4999,
    };
    return { body };
  });

  fake.route('GET /user', () => ({
    body: {
      ...example<Json>(
        'github',
        'private-user-response-with-public-and-private-profile-information',
      ),
      login: viewer,
      html_url: `${WEB}/${viewer}`,
    },
  }));

  fake.route('GET /repos/{owner}/{repo}', ({ params }) =>
    isRepo(params) ? { body: repository() } : fake.notFound(),
  );

  fake.route(
    'GET /repos/{owner}/{repo}/contents/{path}',
    ({ params, query, headers }) => {
      const ref = query.get('ref') ?? 'main';
      const content = files.get(`${ref}:${params.path}`);
      const entry = (path: string, type: string) => ({
        ...example<Json[]>(
          'github',
          'content-file-response-if-content-is-a-directory',
        )[0],
        type,
        name: path.split('/').pop(),
        path,
      });

      if (content === undefined) {
        const children = [...files.keys()]
          .filter((key) => key.startsWith(`${ref}:${params.path}/`))
          .map((key) => entry(key.slice(ref.length + 1), 'file'));
        return children.length ? { body: children } : fake.notFound();
      }
      if (headers.get('accept')?.includes('raw')) return { text: content };

      const bytes = Buffer.byteLength(content);
      const large = bytes > largeFileBytes;
      return {
        body: {
          ...example<Json>(
            'github',
            'content-file-response-if-content-is-a-file',
          ),
          name: params.path.split('/').pop(),
          path: params.path,
          size: bytes,
          encoding: large ? 'none' : 'base64',
          // GitHub wraps base64 at 60 characters.
          content: large
            ? ''
            : Buffer.from(content)
                .toString('base64')
                .replace(/(.{60})/g, '$1\n'),
        },
      };
    },
  );

  // Tree SHAs handed out for subdirectories, so they can be fetched by SHA.
  const trees = new Map<string, { ref: string; dir: string }>();
  const treeSha = (ref: string, dir: string) => {
    const sha = Buffer.from(`${ref}:${dir}`)
      .toString('hex')
      .padEnd(40, '0')
      .slice(0, 40);
    trees.set(sha, { ref, dir });
    return sha;
  };

  fake.route(
    'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
    ({ params, query }) => {
      const { ref, dir } = trees.get(params.tree_sha) ?? {
        ref: params.tree_sha === 'HEAD' ? 'main' : params.tree_sha,
        dir: '',
      };
      const prefix = dir ? `${dir}/` : '';
      const paths = [...files.keys()]
        .filter((key) => key.startsWith(`${ref}:${prefix}`))
        .map((key) => key.slice(ref.length + 1 + prefix.length));
      if (!paths.length) return fake.notFound();

      const recursive = query.has('recursive');
      const entries = new Map<string, Json>();
      for (const path of paths) {
        const parts = path.split('/');
        const depth = recursive ? parts.length : 1;
        for (let i = 1; i <= depth; i++) {
          const sub = parts.slice(0, i).join('/');
          const isFile = i === parts.length;
          entries.set(sub, {
            path: sub,
            mode: isFile ? '100644' : '040000',
            type: isFile ? 'blob' : 'tree',
            sha: isFile ? '0'.repeat(40) : treeSha(ref, prefix + sub),
            url: `${API}/repos/${owner}/${repo}/git/x`,
          });
        }
      }
      const tree = [...entries.values()];
      return {
        body: {
          sha: treeSha(ref, dir),
          url: `${API}/repos/${owner}/${repo}/git/trees/${params.tree_sha}`,
          tree: tree.slice(0, treeLimit),
          truncated: recursive && tree.length > treeLimit,
        },
      };
    },
  );

  fake.route('GET /repos/{owner}/{repo}/issues', ({ query }) => {
    const state = query.get('state') ?? 'open';
    const labels = query.get('labels')?.split(',') ?? [];
    const list = [...issues.values()].filter(
      (i) =>
        (state === 'all' || i.state === state) &&
        (!query.get('creator') ||
          (i.user as Json).login === query.get('creator')) &&
        (!query.get('assignee') ||
          (i.assignees as Json[]).some(
            (a) => a.login === query.get('assignee'),
          )) &&
        labels.every((name) =>
          (i.labels as Json[]).some((l) => l.name === name),
        ),
    );
    return fake.page(list, query);
  });

  fake.route('POST /repos/{owner}/{repo}/issues', ({ body }) => ({
    status: 201,
    body: newIssue(body as never),
  }));

  fake.route(
    'GET /repos/{owner}/{repo}/issues/{issue_number}',
    ({ params }) => {
      const issue = issues.get(Number(params.issue_number));
      return issue ? { body: issue } : fake.notFound();
    },
  );

  fake.route(
    'PATCH /repos/{owner}/{repo}/issues/{issue_number}',
    ({ params, body }) => {
      const issue = issues.get(Number(params.issue_number));
      if (!issue) return fake.notFound();
      Object.assign(issue, body, { updated_at: now() });
      if (body?.state === 'closed') issue.closed_at = now();
      return { body: issue };
    },
  );

  fake.route(
    'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
    ({ params, body }) => {
      const issue = issues.get(Number(params.issue_number));
      if (!issue) return fake.notFound();
      const names = new Set((issue.labels as Json[]).map((l) => l.name));
      for (const name of (body as { labels: string[] }).labels) {
        if (!names.has(name)) (issue.labels as Json[]).push(label(name));
      }
      return {
        body: (issue.labels as Json[]).map((l) => ({
          ...example<Json[]>('github', 'label-items')[0],
          ...l,
          archived_at: null,
          archived_by: null,
        })),
      };
    },
  );

  fake.route(
    'POST /repos/{owner}/{repo}/issues/{issue_number}/assignees',
    ({ params, body }) => {
      const issue = issues.get(Number(params.issue_number));
      if (!issue) return fake.notFound();
      const current = (issue.assignees as Json[]).map((a) => a.login as string);
      const all = [
        ...new Set([
          ...current,
          ...(body as { assignees: string[] }).assignees,
        ]),
      ];
      issue.assignees = all.map(user);
      return { status: 201, body: issue };
    },
  );

  fake.route(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
    ({ params, query }) => {
      const n = Number(params.issue_number);
      return fake.page(
        [...comments.values()]
          .filter((c) => c.issue_number === n)
          .map(({ issue_number: _, ...c }) => c),
        query,
      );
    },
  );

  fake.route(
    'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
    ({ params, body }) => {
      const n = Number(params.issue_number);
      const issue = issues.get(n);
      if (!issue) return fake.notFound();
      const id = nextId++;
      const created = now();
      const comment = {
        ...example<Json>('github', 'issue-comment'),
        id,
        body: (body as { body: string }).body,
        user: user(viewer),
        html_url: `${issue.html_url}#issuecomment-${id}`,
        created_at: created,
        updated_at: created,
        issue_number: n,
      };
      comments.set(id, comment);
      const { issue_number: _, ...response } = comment;
      return { status: 201, body: response };
    },
  );

  fake.route(
    'GET /repos/{owner}/{repo}/issues/comments/{comment_id}',
    ({ params }) => {
      const comment = comments.get(Number(params.comment_id));
      if (!comment) return fake.notFound();
      const { issue_number: _, ...response } = comment;
      return { body: response };
    },
  );

  fake.route(
    'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}',
    ({ params, body }) => {
      const comment = comments.get(Number(params.comment_id));
      if (!comment) return fake.notFound();
      Object.assign(comment, body, { updated_at: now() });
      const { issue_number: _, ...response } = comment;
      return { body: response };
    },
  );

  fake.route('GET /repos/{owner}/{repo}/pulls', ({ query }) => {
    const state = query.get('state') ?? 'open';
    return fake.page(
      [...pulls.values()]
        .filter((p) => state === 'all' || p.state === state)
        .map(withLabels),
      query,
    );
  });

  fake.route('POST /repos/{owner}/{repo}/pulls', ({ body }) => ({
    status: 201,
    body: withLabels(newPull(body as never)),
  }));

  fake.route('GET /repos/{owner}/{repo}/pulls/{pull_number}', ({ params }) => {
    const pull = pulls.get(Number(params.pull_number));
    return pull ? { body: withLabels(pull) } : fake.notFound();
  });

  fake.route(
    'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
    ({ params, body }) => {
      const n = Number(params.pull_number);
      const pull = pulls.get(n);
      if (!pull) return fake.notFound();
      Object.assign(pull, body);
      Object.assign(issues.get(n)!, body);
      return { body: withLabels(pull) };
    },
  );

  fake.route(
    'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
    ({ params }) => {
      const n = Number(params.pull_number);
      const pull = pulls.get(n);
      if (!pull) return fake.notFound();
      Object.assign(pull, { state: 'closed', merged: true, merged_at: now() });
      issues.get(n)!.state = 'closed';
      return {
        body: {
          ...example<Json>(
            'github',
            'pull-request-merge-result-response-if-merge-was-successful',
          ),
          sha: `merge-${n}`,
        },
      };
    },
  );

  fake.route(
    'POST /repos/{owner}/{repo}/statuses/{sha}',
    ({ params, body }) => {
      const status = {
        ...example<Json>('github', 'status'),
        id: nextId++,
        state: body!.state,
        context: body!.context ?? 'default',
        description: body!.description ?? null,
        target_url: body!.target_url ?? null,
        created_at: now(),
      };
      statuses.set(params.sha, [status, ...(statuses.get(params.sha) ?? [])]);
      return { status: 201, body: status };
    },
  );

  fake.route(
    'GET /repos/{owner}/{repo}/commits/{ref}/statuses',
    ({ params, query }) => fake.page(statuses.get(params.ref) ?? [], query),
  );

  return { fake, issues, pulls, comments, newIssue, newPull, setFile, repoUrl };
}
