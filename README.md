# forgewright

One TypeScript API for many git forges. Write automation once, and run it against GitHub or GitLab.

```ts
import { getProject, servicesFromEnv } from 'forgewright';

// GITHUB_TOKEN and/or GITLAB_TOKEN (+ CI_SERVER_URL for self-managed GitLab)
const project = await getProject(
  'https://gitlab.com/group/sub/widgets',
  servicesFromEnv(),
);

const issue = await project.createIssue('Widgets wobble', 'They wobble.', {
  labels: ['bug'],
  assignees: ['bob'],
});
await issue.comment('Looking into it');

for (const comment of await issue.getComments()) {
  console.log(comment.author, comment.body); // system notes ("added ~bug") are left out
}
```

> **Status:** private prototype. Not published to npm, and the API will change.

## What's supported

|                                                                                | GitHub | GitLab            |
| ------------------------------------------------------------------------------ | ------ | ----------------- |
| Projects: get, from URL, exists                                                | ✓      | ✓ (nested groups) |
| Issues: list/filter, get, create, close, title/description, labels, assignees  | ✓      | ✓                 |
| Comments on issues and PRs/MRs: list/filter, get, create, edit                 | ✓      | ✓                 |
| Pull/merge requests: list by status, get, create, update, close, merge, labels | ✓      | ✓                 |
| Commit statuses: set, list, PR head statuses                                   | ✓      | ✓                 |
| Current user                                                                   | ✓      | ✓                 |

Differences are explicit: something one forge can't do throws `OperationNotSupported` instead of silently doing less. For example, GitHub has no private issues, and GitLab Free drops extra assignees without reporting an error.

## Design

### The model is borrowed from ogr

The object model follows [packit/ogr](https://github.com/packit/ogr)'s `ogr/abstract/*` (`GitService` → `GitProject` → `Issue` / `PullRequest` → `Comment`, plus `CommitFlag`, status enums and the exception hierarchy), with ogr's names converted to camelCase. forgewright borrows the design only; no code is ported. ogr is Python and lazy (reading `issue.title` can make a request). forgewright uses hydrated objects instead:

- `await project.getIssue(5)` returns an `Issue` whose fields are plain data. Reading a field never makes a request.
- Anything that talks to the forge is an async method, such as `await issue.close()` or `await issue.setTitle('…')`, and updates the object in place.
- `refresh()` re-fetches the object, and `toJSON()` returns plain data.

### Built on each forge's OpenAPI description

There's no Octokit or gitbeaker. Each forge's client is [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) over types generated from the forge's own OpenAPI description:

```
spec/<forge>/config.json      pinned upstream description + the operations we use
spec/gitlab/overlays/*.yaml   OpenAPI Overlays that fix upstream mistakes
        │  npm run specs:update
        ▼
spec/<forge>/openapi.json     trimmed description (used to validate test traffic)
src/services/<forge>/openapi.d.ts   generated types (used by the client)
```

`npm run specs:update` downloads the pinned descriptions, applies the overlays, keeps only the listed operations and unused-component-pruned schemas, and regenerates the types. It fails if an overlay stops matching (upstream may have fixed the issue) or if a listed operation disappears. CI checks that the generated files are up to date.

The upstream problems found so far, each fixed by an overlay in `spec/gitlab/overlays/`:

- **GitLab** list endpoints (`GET …/issues`, `…/merge_requests`, `…/notes`, `…/statuses`, `/users`) are declared to return a single object, not an array.
- **GitLab** `assignees` and `reviewers` are declared as a single user, not an array.
- **GitLab** marks no properties as `required` and misses nullable fields such as `description`, `closed_at` and `merged_at`.
- **GitHub**'s bundled examples lag its schemas. For example, `full-repository` lacks `language`, and labels lack `archived_at`. These examples are only used in tests, which patch them.

### Tests run against spec-validated fakes

`test/support/fake-{github,gitlab}.ts` are small stateful fakes built on [msw](https://mswjs.io/). GitHub's fake starts from the examples in GitHub's description. GitLab's is sampled from the property examples in GitLab's description. **Every request body and response they handle is validated against the OpenAPI description**, so a fake that drifts from the spec, or a mapper that sends the wrong shape, fails the test.

- `test/conformance/` has one suite that runs unchanged against both forges.
- `test/services/` covers forge-specific behavior: GitLab system notes, nested groups, the assignee limit on Free, and GitHub pull requests appearing in issue lists.

```sh
npm test            # vitest
npm run lint        # eslint + prettier
npm run typecheck
npm run build
npm run specs:update
```

## Next

- Record real fixtures from a scratch GitHub repo and gitlab.com project, and validate them against the descriptions. This will surface the remaining nullability gaps. One to check: `issue.pull_request.merged_at`, which GitHub's description marks as non-nullable.
- Try it in practice: port [bulk-issue-creator](https://github.com/benbalter/bulk-issue-creator) onto forgewright on a branch and run it against GitLab.
- Deferred, following ogr's layout: releases, files and branches, forks, access control, reactions, commit comments, Forgejo, and GitHub App auth.
