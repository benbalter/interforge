import type { paths } from '../../src/services/gitlab/openapi.js';
import { FakeForge, type Json } from './fake.js';
import { sample } from './openapi.js';

interface Options {
  instanceUrl?: string;
  /** Full project path. Nested groups on purpose, to exercise ID encoding. */
  path?: string;
  hasIssues?: boolean;
  viewer?: string;
  /** GitLab Free keeps one assignee. Premium and up keep more. */
  maxAssignees?: number;
  /** Older instances ignore activity_filter and return system notes. */
  honorActivityFilter?: boolean;
}

const USERS = ['alice', 'bob', 'carol'];

/**
 * A small stateful GitLab, built from samples of the (overlaid) OpenAPI
 * description. Issues and merge requests each have their own iid sequence.
 */
export function fakeGitlab({
  instanceUrl = 'https://gitlab.example.com',
  path = 'octo-org/platform/widgets',
  hasIssues = true,
  viewer = 'alice',
  maxAssignees = 1,
  honorActivityFilter = true,
}: Options = {}) {
  const fake = new FakeForge<paths>('gitlab', instanceUrl);
  const issues = new Map<number, Json>();
  const mergeRequests = new Map<number, Json>();
  const notes = {
    issues: new Map<number, Json[]>(),
    merge_requests: new Map<number, Json[]>(),
  };
  const statuses = new Map<string, Json[]>();
  const files = new Map<string, string>(); // `${ref}:${path}` -> content
  const setFile = (path: string, content: string, ref = 'main') =>
    files.set(`${ref}:${path}`, content);
  let nextIssue = 1;
  let nextMr = 1;
  let nextId = 5000;
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const now = () => new Date((clock += 60_000)).toISOString();
  const webUrl = `${instanceUrl}/${path}`;
  const projectName = path.split('/').pop()!;

  const user = (username: string) => ({
    ...sample<Json>('gitlab', 'APIEntitiesUserBasic'),
    id: USERS.indexOf(username) + 1,
    username,
    web_url: `${instanceUrl}/${username}`,
  });
  const usernameFor = (id: number) => USERS[id - 1];

  function newIssue(fields: {
    title: string;
    description?: string | null;
    labels?: string[];
    assignee_ids?: number[];
    confidential?: boolean;
  }) {
    const iid = nextIssue++;
    const issue = {
      ...sample<Json>('gitlab', 'APIEntitiesIssue'),
      id: nextId++,
      iid,
      title: fields.title,
      description: fields.description ?? null,
      state: 'opened',
      web_url: `${webUrl}/-/issues/${iid}`,
      author: user(viewer),
      labels: fields.labels ?? [],
      assignees: (fields.assignee_ids ?? [])
        .slice(0, maxAssignees)
        .map((id) => user(usernameFor(id))),
      confidential: fields.confidential ?? false,
      created_at: now(),
      closed_at: null,
    };
    issues.set(iid, issue);
    return issue;
  }

  function newMergeRequest(fields: {
    title: string;
    description?: string | null;
    source_branch: string;
    target_branch: string;
  }) {
    const iid = nextMr++;
    const mr = {
      ...sample<Json>('gitlab', 'APIEntitiesMergeRequest'),
      id: nextId++,
      iid,
      title: fields.title,
      description: fields.description ?? null,
      state: 'opened',
      web_url: `${webUrl}/-/merge_requests/${iid}`,
      author: user(viewer),
      labels: [],
      assignees: [],
      reviewers: [],
      source_branch: fields.source_branch,
      target_branch: fields.target_branch,
      source_project_id: 1,
      target_project_id: 1,
      sha: `sha-${fields.source_branch}`,
      created_at: now(),
      merged_at: null,
      closed_at: null,
    };
    mergeRequests.set(iid, mr);
    return mr;
  }

  function addNote(
    kind: 'issues' | 'merge_requests',
    iid: number,
    body: string,
    system = false,
  ) {
    const created = now();
    const note = {
      ...sample<Json>('gitlab', 'APIEntitiesNote'),
      id: nextId++,
      body,
      author: user(viewer),
      created_at: created,
      updated_at: created,
      system,
      noteable_iid: iid,
    };
    notes[kind].set(iid, [...(notes[kind].get(iid) ?? []), note]);
    return note;
  }

  const project = () => ({
    ...sample<Json>('gitlab', 'APIEntitiesProjectsWithAccessAndCatalogSetting'),
    id: 1,
    path: projectName,
    path_with_namespace: path,
    namespace: {
      ...sample<Json>('gitlab', 'APIEntitiesNamespaceBasic'),
      full_path: path.split('/').slice(0, -1).join('/'),
    },
    web_url: webUrl,
    description: null,
    default_branch: 'main',
    visibility: 'private',
    issues_enabled: hasIssues,
  });

  const isProject = (p: Record<string, string>) => p.id === path;
  const P = '/api/v4/projects/{id}';

  fake.route('GET /api/v4/user', () => ({
    body: {
      ...sample<Json>('gitlab', 'APIEntitiesUserPublic'),
      ...user(viewer),
    },
  }));

  fake.route('GET /api/v4/users', ({ query }) => ({
    body: USERS.filter((u) => u === query.get('username')).map(user),
  }));

  fake.route(`GET ${P}`, ({ params }) =>
    isProject(params) ? { body: project() } : fake.notFound(),
  );

  fake.route(`GET ${P}/repository/files/{file_path}`, ({ params, query }) => {
    const ref = query.get('ref') === 'HEAD' ? 'main' : query.get('ref');
    if (!ref) return { status: 400, body: { error: 'ref is missing' } };
    const content = files.get(`${ref}:${params.file_path}`);
    // Directories and missing files are both 404s on GitLab.
    if (content === undefined)
      return { status: 404, body: { message: '404 File Not Found' } };
    return {
      body: {
        file_name: params.file_path.split('/').pop(),
        file_path: params.file_path,
        size: Buffer.byteLength(content),
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
        ref,
        blob_id: 'blob',
        commit_id: 'commit',
      },
    };
  });

  fake.route(`GET ${P}/repository/tree`, ({ query }) => {
    const ref =
      !query.get('ref') || query.get('ref') === 'HEAD'
        ? 'main'
        : query.get('ref')!;
    const recursive = query.get('recursive') === 'true';
    const entries = new Map<string, Json>();
    for (const key of files.keys()) {
      if (!key.startsWith(`${ref}:`)) continue;
      const parts = key.slice(ref.length + 1).split('/');
      for (let i = 1; i <= (recursive ? parts.length : 1); i++) {
        const path = parts.slice(0, i).join('/');
        const isFile = i === parts.length;
        entries.set(path, {
          id: 'f'.repeat(40),
          name: parts[i - 1],
          type: isFile ? 'blob' : 'tree',
          path,
          mode: isFile ? '100644' : '040000',
        });
      }
    }
    if (!entries.size)
      return { status: 404, body: { message: '404 Tree Not Found' } };

    // Keyset pagination: page_token is where the next page starts.
    const all = [...entries.values()];
    const legacy = fake.legacyTreePagination;
    const perPageRequested = Number(query.get('per_page') ?? 20);
    const start = legacy
      ? (Number(query.get('page') ?? 1) - 1) *
        Math.min(perPageRequested, fake.pageSize)
      : Number(query.get('page_token') ?? 0);
    const perPage = Math.min(
      Number(query.get('per_page') ?? 20),
      fake.pageSize,
    );
    const next = start + perPage;
    const link = new URL(`${instanceUrl}/api/v4/projects/1/repository/tree`);
    const params = Object.fromEntries(query);
    delete params.page_token;
    delete params.page;
    link.search = new URLSearchParams(
      legacy
        ? {
            ...params,
            page: String(start / Math.min(perPageRequested, fake.pageSize) + 2),
          }
        : { ...params, page_token: String(next) },
    ).toString();
    return {
      body: all.slice(start, next),
      headers:
        next < all.length ? { Link: `<${link}>; rel="next"` } : undefined,
    };
  });

  fake.route(`GET ${P}/issues`, ({ params, query }) => {
    if (!isProject(params)) return fake.notFound();
    const state = query.get('state') ?? 'all';
    const labels = query.get('labels')?.split(',') ?? [];
    const assignee = query.get('assignee_username');
    return fake.page(
      [...issues.values()].filter(
        (i) =>
          (state === 'all' || i.state === state) &&
          (!query.get('author_username') ||
            (i.author as Json).username === query.get('author_username')) &&
          (!assignee ||
            (i.assignees as Json[]).some((a) => a.username === assignee)) &&
          labels.every((l) => (i.labels as string[]).includes(l)),
      ),
      query,
    );
  });

  fake.route(`POST ${P}/issues`, ({ params, body }) =>
    isProject(params)
      ? { status: 201, body: newIssue(body as never) }
      : fake.notFound(),
  );

  fake.route(`GET ${P}/issues/{issue_iid}`, ({ params }) => {
    const issue = issues.get(Number(params.issue_iid));
    return issue ? { body: issue } : fake.notFound();
  });

  fake.route(`PUT ${P}/issues/{issue_iid}`, ({ params, body }) => {
    const issue = issues.get(Number(params.issue_iid));
    if (!issue) return fake.notFound();
    const { state_event, add_labels, assignee_ids, ...fields } = body as Json;
    Object.assign(issue, fields);
    if (state_event === 'close')
      Object.assign(issue, { state: 'closed', closed_at: now() });
    if (add_labels)
      issue.labels = [
        ...new Set([
          ...(issue.labels as string[]),
          ...(add_labels as string[]),
        ]),
      ];
    if (assignee_ids) {
      issue.assignees = (assignee_ids as number[])
        .slice(0, maxAssignees)
        .map((id) => user(usernameFor(id)));
    }
    return { body: issue };
  });

  fake.route(`GET ${P}/merge_requests`, ({ params, query }) => {
    if (!isProject(params)) return fake.notFound();
    const state = query.get('state') ?? 'all';
    return fake.page(
      [...mergeRequests.values()].filter(
        (m) => state === 'all' || m.state === state,
      ),
      query,
    );
  });

  fake.route(`POST ${P}/merge_requests`, ({ params, body }) =>
    isProject(params)
      ? { status: 201, body: newMergeRequest(body as never) }
      : fake.notFound(),
  );

  fake.route(`GET ${P}/merge_requests/{merge_request_iid}`, ({ params }) => {
    const mr = mergeRequests.get(Number(params.merge_request_iid));
    return mr ? { body: mr } : fake.notFound();
  });

  fake.route(
    `PUT ${P}/merge_requests/{merge_request_iid}`,
    ({ params, body }) => {
      const mr = mergeRequests.get(Number(params.merge_request_iid));
      if (!mr) return fake.notFound();
      const { state_event, add_labels, ...fields } = body as Json;
      Object.assign(mr, fields);
      if (state_event === 'close')
        Object.assign(mr, { state: 'closed', closed_at: now() });
      if (add_labels)
        mr.labels = [
          ...new Set([...(mr.labels as string[]), ...(add_labels as string[])]),
        ];
      return { body: mr };
    },
  );

  fake.route(
    `PUT ${P}/merge_requests/{merge_request_iid}/merge`,
    ({ params }) => {
      const mr = mergeRequests.get(Number(params.merge_request_iid));
      if (!mr) return fake.notFound();
      Object.assign(mr, { state: 'merged', merged_at: now() });
      return { body: mr };
    },
  );

  for (const kind of ['issues', 'merge_requests'] as const) {
    const parents = kind === 'issues' ? issues : mergeRequests;

    fake.route(`GET ${P}/${kind}/{noteable_id}/notes`, ({ params, query }) => {
      let list = notes[kind].get(Number(params.noteable_id)) ?? [];
      if (
        honorActivityFilter &&
        query.get('activity_filter') === 'only_comments'
      ) {
        list = list.filter((n) => !n.system);
      }
      if (query.get('sort') !== 'asc') list = [...list].reverse(); // GitLab defaults to newest first
      return fake.page(list, query);
    });

    fake.route(`POST ${P}/${kind}/{noteable_id}/notes`, ({ params, body }) => {
      const iid = Number(params.noteable_id);
      if (!parents.has(iid)) return fake.notFound();
      return {
        status: 201,
        body: addNote(kind, iid, (body as { body: string }).body),
      };
    });

    fake.route(
      `GET ${P}/${kind}/{noteable_id}/notes/{note_id}`,
      ({ params }) => {
        const note = notes[kind]
          .get(Number(params.noteable_id))
          ?.find((n) => n.id === Number(params.note_id));
        return note ? { body: note } : fake.notFound();
      },
    );

    fake.route(
      `PUT ${P}/${kind}/{noteable_id}/notes/{note_id}`,
      ({ params, body }) => {
        const note = notes[kind]
          .get(Number(params.noteable_id))
          ?.find((n) => n.id === Number(params.note_id));
        if (!note) return fake.notFound();
        Object.assign(note, {
          body: (body as { body: string }).body,
          updated_at: now(),
        });
        return { body: note };
      },
    );
  }

  fake.route(`POST ${P}/statuses/{sha}`, ({ params, body }) => {
    const status = {
      ...sample<Json>('gitlab', 'APIEntitiesCommitStatus'),
      id: nextId++,
      sha: params.sha,
      status: body!.state,
      name: body!.name ?? 'default',
      description: body!.description ?? null,
      target_url: body!.target_url ?? null,
      created_at: now(),
    };
    statuses.set(params.sha, [...(statuses.get(params.sha) ?? []), status]);
    return { body: status };
  });

  fake.route(
    `GET ${P}/repository/commits/{sha}/statuses`,
    ({ params, query }) => fake.page(statuses.get(params.sha) ?? [], query),
  );

  return {
    fake,
    issues,
    mergeRequests,
    notes,
    addNote,
    newIssue,
    newMergeRequest,
    setFile,
    webUrl,
  };
}
