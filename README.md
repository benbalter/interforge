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

|                                                                                | GitHub                           | GitLab                |
| ------------------------------------------------------------------------------ | -------------------------------- | --------------------- |
| Projects: get, from URL, exists                                                | ✓                                | ✓ (nested groups)     |
| Issues: list/filter, get, create, close, title/description, labels, assignees  | ✓                                | ✓                     |
| Comments on issues and PRs/MRs: list/filter, get, create, edit                 | ✓                                | ✓                     |
| Pull/merge requests: list by status, get, create, update, close, merge, labels | ✓                                | ✓                     |
| Commit statuses: set, list, PR head statuses                                   | ✓                                | ✓                     |
| File contents at a branch, tag or commit                                       | ✓ (incl. files over 1 MB)        | ✓                     |
| List files: top level or recursive, regex filter, at a ref                     | ✓ (walks trees GitHub truncates) | ✓ (keyset pagination) |
| Retries, timeouts, rate limits, remaining quota                                | ✓                                | ✓                     |
| Lazy iteration and limits for issues, PRs, comments, statuses                  | ✓                                | ✓                     |
| Dry run (reads go through, writes are recorded)                                | ✓                                | ✓                     |
| Current user                                                                   | ✓                                | ✓                     |

Differences are explicit: something one forge can't do throws `OperationNotSupported` instead of silently doing less. For example, GitHub has no private issues, and GitLab Free drops extra assignees without reporting an error.

## Lists and limits

Every list can be iterated lazily. Pages are fetched only as you consume them, so stopping early saves requests:

```ts
for await (const issue of project.iterateIssues({ status: 'all' })) {
  if (issue.title.includes('flaky')) break; // no more pages are fetched
}

await project.getIssueList({ labels: ['bug'], limit: 10 }); // asks for 10, not 100
await issue.getComments({ limit: 5 }); // oldest five
await issue.getComments({ reverse: true, limit: 5 }); // newest five (fetches all)
```

The same `iterate*()` and `limit` pairs cover issues, pull requests, comments and commit statuses.

## Dry run

Like ogr's read-only mode: reads go to the forge as usual, but writes are skipped and recorded.

- **Creates** return stand-in objects with `id: 0`.
- **Updates** change only the local object.
- **Recording:** every skipped write goes into `service.dryRunLog`, and to your callback if you pass one.

```ts
const service = new GitlabService({
  token,
  dryRun: ({ action, target, details }) =>
    console.log(`[dry run] ${action} ${target}`, details),
});
const issue = await project.createIssue('Title', 'Body', { labels: ['bug'] });
// issue.id === 0, nothing was created, and service.dryRunLog has the createIssue
```

`service.dryRun` can be switched at any time. Stand-ins are only useful while dry run is on, because their `id: 0` doesn't exist on the forge.

## Supported versions and runtimes

- **Runtimes:** Node 22+, browsers, and Workers-style runtimes. The library uses only `fetch`, `atob` and `TextDecoder`. CI bundles it for the browser with esbuild, which fails on any Node built-in, including inside dependencies.
- **GitHub.com:** requests REST API version `2026-03-10` (`GITHUB_API_VERSION`), the version the types are generated from.
- **GitHub Enterprise Server:** set `instanceUrl`, and requests go to `<instance>/api/v3`. A server that doesn't know the default API version rejects every request, so pass a version it supports, such as `apiVersion: '2022-11-28'`. Not tested against a real server.
- **GitLab:** built from GitLab 19.4's description and tested on gitlab.com. Older self-managed versions aren't tested. Two things degrade gracefully on older instances:
  - If `activity_filter` is ignored, system notes are still filtered out locally.
  - If the repository tree has no keyset pagination, file listing falls back to page numbers.
- **When the specs move ahead of a server:** the weekly spec update tracks the latest releases. The mappers only require the fields that overlay 03 declares, and those were checked against live gitlab.com traffic.

## Rate limits and retries

Both clients retry and time out by default:

- **Rate limits** are retried for any method, because a rate-limited request wasn't carried out. That includes GitHub's 403-style limits and secondary limits, not just 429. forgewright waits for `Retry-After` or the reset time.
- **Long limits:** if a limit won't clear within `maxWait`, the call throws `RateLimitError` with `resetAt` instead of sleeping.
- **Server errors and network failures** (500/502/503/504) are retried with backoff and jitter, for reads only. A failed write may still have taken effect.
- **Rate-limit quota:** `service.rateLimit` holds the latest rate-limit headers, and `getRateLimitRemaining()` reports the remaining quota. GitHub checks this without spending quota; GitLab uses the last response's headers.

```ts
new GitlabService({
  token,
  retry: {
    retries: 3, // after the first attempt
    maxWait: 60_000, // ms; longer limits throw RateLimitError
    baseDelay: 1000, // first backoff; doubles each retry
    timeout: 30_000, // per attempt; false for none
    onRetry: ({ reason, wait, url }) =>
      console.warn(`retrying ${url}: ${reason}`),
  },
});
new GithubService({ token, retry: false }); // no retries
```

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
- **GitLab**'s repository file endpoint has no response schema at all.
- **GitHub** marks `issue.pull_request.merged_at` as non-nullable, but the API returns `null` for unmerged pull requests.
- **GitHub**'s pull request list schema marks label `description` as non-nullable, although the full pull request schema, and the API, allow `null`.
- **GitHub**'s bundled examples lag its schemas. For example, `full-repository` lacks `language`, and labels lack `archived_at`. These examples are only used in tests, which patch them.

About 60 more nullability gaps show up in real traffic, almost all in fields forgewright doesn't read (milestones, time stats, `auto_merge`, …). These are left alone until something depends on them.

### Libraries over custom code

Runtime dependencies:

- [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) for the typed HTTP client.
- [ky](https://github.com/sindresorhus/ky) for retries, backoff, jitter and timeouts.
- [http-link-header](https://github.com/jhermsmeier/node-http-link-header) for pagination links.
- [git-url-parse](https://github.com/IonicaBizau/git-url-parse) for project URLs.

Build and test tooling:

- openapi-format and openapi-typescript build the specs and types.
- msw with [openapi-msw](https://github.com/christoph-fricke/openapi-msw) runs the fakes. A misspelled fake route fails to compile.
- [openapi-backend](https://github.com/openapistack/openapi-backend) validates every request and response against the spec.
- [openapi-sampler](https://github.com/Redocly/openapi-sampler) builds sample objects from the spec.

Custom code is kept only where no suitable library exists:

| Custom code                                                  | Why                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forge-specific rate-limit rules                              | ky can't express GitHub's 403 limits, or failing fast instead of capping the wait.                                                                                                                                                                                                                                    |
| Rate-limit header parser                                     | The only one on npm (`ratelimit-header-parser`) is an unmaintained 0.1.0 release from 2023.                                                                                                                                                                                                                           |
| Keeping only the used operations (`scripts/update-specs.ts`) | openapi-format's `inverseOperationIds` also deletes schema properties named after HTTP methods, such as `head` in GitHub's create-PR body ([openapi-format#238](https://github.com/thim81/openapi-format/issues/238)).                                                                                                |
| Converting `nullable` for the test validator                 | openapi-format's 3.1 conversion drops `nullable` next to `allOf` ([openapi-format#239](https://github.com/thim81/openapi-format/issues/239)), `@openapi-contrib/openapi-schema-to-json-schema` drops it next to `allOf` and `oneOf`, and `@scalar/openapi-upgrader` drops it next to `oneOf`. GitHub's spec has both. |
| Recognizing GitHub sub-page URLs (`…/pull/7/files`)          | git-url-parse reads these as part of the repository path.                                                                                                                                                                                                                                                             |
| Mappers and comment filtering                                | This is the library's own logic.                                                                                                                                                                                                                                                                                      |

### Tests run against spec-validated fakes

`test/support/fake-{github,gitlab}.ts` are small stateful fakes built on [msw](https://mswjs.io/). GitHub's fake starts from the examples in GitHub's description. GitLab's is sampled from the property examples in GitLab's description. **Every request (path, query and body) and every response they handle is validated against the OpenAPI description**, so a fake that drifts from the spec, or a mapper that sends the wrong shape, fails the test.

- `test/conformance/` has one suite that runs unchanged against both forges.
- `test/services/` covers forge-specific behavior: GitLab system notes, nested groups, the assignee limit on Free, and GitHub pull requests appearing in issue lists.

```sh
npm test            # vitest
npm run lint        # eslint + prettier
npm run typecheck
npm run build
npm run specs:update
npm run specs:bump   # move pins to the latest upstream descriptions

# Live tests against a scratch repository (writes to it; cleans up after)
FORGEWRIGHT_GITHUB_TOKEN=… FORGEWRIGHT_GITHUB_REPO=owner/repo npm run test:live
```

## Verified so far

- The unit and conformance tests all run against the fakes.
- A read-only run against real data: `benbalter/word-to-markdown` on GitHub, and `gitlab-org/api/client-go` on gitlab.com anonymously. It covered project lookup (including nested-group `%2F` encoding), issue and PR/MR lists with `Link` pagination, comma-separated label filters, file contents (nested paths and refs), PRs being left out of GitHub issue lists, GitHub comments, and merged-status filtering.
- **GitHub, writes included:** `npm run test:live` runs the full lifecycle against a scratch repository. That covers issues, comments, labels, assignees, files on a branch, pull requests (including merging) and commit statuses, plus a dry run. Every response is checked against GitHub's spec, with 0 mismatches after the overlays. GitHub's list endpoints can lag a write by a few seconds, so the suite polls for those checks.
- **GitLab:** not yet verified live for writes, notes or commit statuses. gitlab.com answers `401` for those without a token, even on public projects.
- Anonymous gitlab.com requests get a reduced project view without `issues_enabled`. `hasIssues` then defaults to `true`.

## Next

- Run the live suite against GitLab. It needs a token and a scratch project.
- Try GitHub Enterprise Server and an older self-managed GitLab.
- Try it in practice: port [bulk-issue-creator](https://github.com/benbalter/bulk-issue-creator) onto forgewright on a branch and run it against GitLab.
- See [ROADMAP.md](ROADMAP.md) for the path to full ogr parity and more forges.
