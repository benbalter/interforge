# forgewright

> [!WARNING]
> **Experimental.** forgewright is a prototype: it's private, unpublished, and only partly verified against live forges (see [Verified so far](#verified-so-far)). Expect breaking changes, and don't depend on it for anything that matters yet.

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
src/services/<forge>/openapi.ts   generated types (used by the client)
```

`npm run specs:update` downloads the pinned descriptions, applies the overlays, keeps only the listed operations and unused-component-pruned schemas, and regenerates the types. It fails if an overlay stops matching (upstream may have fixed the issue) or if a listed operation disappears. CI checks that the generated files are up to date.

A scheduled workflow (`.github/workflows/update-specs.yml`, Mondays and on demand) runs `npm run specs:bump` to move the pins to the latest upstream versions: the newest commit and dated API version of `github/rest-api-description`, and the newest stable GitLab release tag. It then regenerates, runs the typecheck and tests, and opens or updates a pull request with the results. If an overlay stops matching or an operation disappears, the run fails instead, because that needs a person to look at it.

The upstream problems found so far, each fixed by an overlay in `spec/<forge>/overlays/`:

- **GitLab** list endpoints (`GET …/issues`, `…/merge_requests`, `…/notes`, `…/statuses`, `/users`) are declared to return a single object, not an array.
- **GitLab** `assignees` and `reviewers` are declared as a single user, not an array.
- **GitLab** marks no properties as `required` and misses nullable fields (`description`, `closed_at`, `merged_at`, `source_project_id`, …). Overlay 03 declares the fields forgewright relies on. That list was checked against live gitlab.com projects, issues, merge requests and users, but not yet notes or statuses.
- **GitHub** marks `issue.pull_request.merged_at` as non-nullable, but the API returns `null` for unmerged pull requests.
- **GitHub**'s bundled examples lag its schemas. For example, `full-repository` lacks `language`, and labels lack `archived_at`. These examples are only used in tests, which patch them.

About 60 more nullability gaps show up in real traffic, almost all in fields forgewright doesn't read (milestones, time stats, `auto_merge`, …). These are left alone until something depends on them.

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
npm run specs:bump   # move pins to the latest upstream descriptions
```

## Verified so far

- The unit and conformance tests all run against the fakes.
- A read-only run against real data: `benbalter/word-to-markdown` on GitHub, and `gitlab-org/api/client-go` on gitlab.com anonymously. It covered project lookup (including nested-group `%2F` encoding), issue and PR/MR lists with `Link` pagination, comma-separated label filters, PRs being left out of GitHub issue lists, GitHub comments, and merged-status filtering.
- Not verified live yet: anything that writes, and GitLab notes and commit statuses. gitlab.com answers `401` for those without a token, even on public projects.
- Anonymous gitlab.com requests get a reduced project view without `issues_enabled`. `hasIssues` then defaults to `true`.

## Next

- Record fixtures from a scratch GitHub repo and gitlab.com project with tokens, covering writes, notes and statuses.
- Try it in practice: port [bulk-issue-creator](https://github.com/benbalter/bulk-issue-creator) onto forgewright on a branch and run it against GitLab.
- Deferred, following ogr's layout: releases, files and branches, forks, access control, reactions, commit comments, Forgejo, and GitHub App auth.
