# Roadmap to full ogr parity

Goal: cover everything in [packit/ogr](https://github.com/packit/ogr)'s abstract API (`ogr/abstract/*`) on GitHub and GitLab, then add more forges. The design stays the same throughout: hydrated objects, async methods, and clients generated from each forge's OpenAPI description.

**Sizes:** S is under half a day, M is 1–2 days, L is 3 days or more. Each size includes the whole per-feature checklist below, on both forges. A rough total for GitHub + GitLab parity (Phases 1–2) is 5–7 weeks of focused work. Forgejo adds 1–2 weeks.

## Checklist for every feature

1. Add the operations to `spec/<forge>/config.json`, then run `npm run specs:update`.
2. Where the upstream description is wrong or missing something, fix it with an overlay in `spec/<forge>/overlays/`, and note what live traffic showed.
3. Add the abstract method (named after ogr's, in camelCase), both forge implementations, and the mappers.
4. Add fake routes. Responses and requests are validated against the spec automatically.
5. Add a conformance test that runs on both forges, plus forge-specific tests for real differences.
6. Verify against a live forge: read-only against public repos, and writes against scratch repos.
7. When a forge can't do something, throw `OperationNotSupported` rather than degrade quietly.

## Done (v0)

| Area            | ogr                                                                                                                           | Status |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| Service         | `get_project`, `get_project_from_url`, `user` (username)                                                                      | ✓      |
| Project         | `full_repo_name`, `description`, `default_branch`, `is_private`, `has_issues`, `exists`, `get_web_url`                        | ✓      |
| Issues          | `get_issue_list`, `get_issue`, `create_issue`, `close`, `add_label`, `add_assignee`, `get_comments`, `get_comment`, `comment` | ✓      |
| Pull requests   | `get_pr_list`, `get_pr`, `create_pr`, `update_info`, `close`, `merge`, `add_label`, `get_comments`, `comment`, `get_statuses` | ✓      |
| Comments        | `body` (read and edit), `author`, `created`, `edited`                                                                         | ✓      |
| Commit statuses | `set_commit_status`, `get_commit_statuses`                                                                                    | ✓      |
| Files           | `get_file_content`, `get_files`                                                                                               | ✓      |
| Service         | `get_rate_limit_remaining`, plus retries, timeouts and rate-limit waits                                                       | ✓      |
| Lists           | `iterate*()` async generators and `limit` for issues, PRs, comments, statuses                                                 | ✓      |
| Read-only mode  | `dryRun` (ogr's `read_only.py`): writes recorded, stand-ins returned                                                          | ✓      |
| Portability     | browsers and Workers (checked in CI); GHES `apiVersion`; supported versions documented                                        | ✓      |

## Phase 1: Harden what exists

Earn trust in the foundation before widening it.

| Item                                         | Size | Notes                                                                                                                                                                            |
| -------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record live fixtures with tokens             | M    | **GitHub done** (`npm run test:live`, scratch repo, 0 spec mismatches). GitLab still needs a token and a scratch project, to cover writes, notes and statuses (401 anonymously). |
| Port bulk-issue-creator onto interforge (M4) | M    | On a local branch, run it end to end against GitLab.                                                                                                                             |
| Port comment-rollup (issues part)            | M    | Needs issue body updates, which exist. Event handling is Phase 4.                                                                                                                |

## Phase 2: ogr parity on GitHub and GitLab

Ordered by how useful each area is to automation tools.

### 2a. Repository contents and history

| ogr                                       | GitHub                | GitLab                               | Size | Notes                                        |
| ----------------------------------------- | --------------------- | ------------------------------------ | ---- | -------------------------------------------- |
| `get_branches`, `get_sha_from_branch`     | `/branches`           | `/repository/branches`               | S    |                                              |
| `get_commits(ref)`                        | `/commits?sha=`       | `/repository/commits?ref_name=`      | S    |                                              |
| `get_tags`, `get_sha_from_tag` → `GitTag` | `/tags`               | `/repository/tags`                   | S    |                                              |
| `get_git_urls`                            | `clone_url`/`ssh_url` | `http_url_to_repo`/`ssh_url_to_repo` | S    | Comes from the project data already fetched. |

### 2b. Releases

| ogr                                                                             | GitHub                                                  | GitLab                                         | Size | Notes                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ---- | ---------------------------- |
| `get_release(identifier, name, tag_name)`, `get_latest_release`, `get_releases` | `/releases`, `/releases/latest`, `/releases/tags/{tag}` | `/projects/:id/releases`, `…/permalink/latest` | M    |                              |
| `create_release`, `edit_release`                                                | `POST`/`PATCH /releases`                                | `POST`/`PUT /releases/:tag`                    | S    | GitLab keys releases by tag. |
| `Release.tarball_url`, `save_archive`                                           | `tarball_url`                                           | `assets.sources`                               | S    |                              |

### 2c. Pull request depth

| ogr                                                                          | GitHub                         | GitLab                           | Size | Notes                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------ | -------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `get_all_commits`                                                            | `/pulls/{n}/commits`           | `/merge_requests/:iid/commits`   | S    |                                                                                            |
| `get_pr_files_diff`                                                          | `/pulls/{n}/files`             | `/merge_requests/:iid/diffs`     | M    | ogr retries while GitLab computes the diff.                                                |
| `patch`, `diff_url`, `commits_url`                                           | `Accept: …diff/patch`          | `…/raw_diffs`, web `.patch`      | S    | These return non-JSON bodies.                                                              |
| `merge_commit_sha`, `merge_commit_status`                                    | `mergeable`, `mergeable_state` | `detailed_merge_status`          | M    | Map both onto ogr's `MergeCommitStatus` (a GitHub value of `null` means "still checking"). |
| `source_project`, `target_project`, `target_branch_head_commit`, `closed_by` | `head.repo`, `base.sha`        | `source_project_id`, `diff_refs` | M    | `head.repo` is `null` for deleted forks, as seen live.                                     |
| `search(filter_regex, description, title)`                                   | client-side                    | client-side                      | S    |                                                                                            |

### 2d. Forks

| ogr                                               | GitHub                  | GitLab                 | Size | Notes                                                             |
| ------------------------------------------------- | ----------------------- | ---------------------- | ---- | ----------------------------------------------------------------- |
| `is_fork`, `parent`, `is_forked`                  | `fork`, `parent`        | `forked_from_project`  | S    |                                                                   |
| `fork_create(namespace)`, `get_fork`, `get_forks` | `POST /forks`, `/forks` | `POST /fork`, `/forks` | M    | Forking is asynchronous on both, so poll until the fork is ready. |
| `create_pr` from a fork                           | `head: owner:branch`    | `target_project_id`    | S    |                                                                   |

### 2e. Access and permissions

| ogr                                                                                                                                                                       | GitHub                                     | GitLab                                     | Size | Notes                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ---- | ------------------------------------------------------------------------ |
| `AccessLevel` enum                                                                                                                                                        | collaborator permission (`pull` … `admin`) | member levels (10–50)                      | S    | Map both onto ogr's pull/triage/push/maintain/admin.                     |
| `get_users_with_given_access`, `who_can_close_issue`, `who_can_merge_pr`, `can_merge_pr`, `has_write_access`, `users_with_write_access`, `get_owners`, `get_contributors` | `/collaborators`, `/contributors`          | `/members/all`, `/repository/contributors` | M    |                                                                          |
| `add_user`, `remove_user`                                                                                                                                                 | `PUT`/`DELETE /collaborators/{u}`          | `POST`/`DELETE /members`                   | S    | GitHub sends an invitation, so the user isn't a collaborator right away. |
| `add_group`, `remove_group`, `which_groups_can_merge_pr`                                                                                                                  | org teams (`/teams/{t}/repos`)             | `/share` with a group                      | M    | GitHub only supports this in organizations.                              |
| `request_access`                                                                                                                                                          | none                                       | `/access_requests`                         | S    | GitLab only; `OperationNotSupported` on GitHub.                          |
| `Issue.can_close`                                                                                                                                                         | derived                                    | derived                                    | S    |                                                                          |

### 2f. Projects, users and groups

| ogr                                                | GitHub                                                   | GitLab                              | Size | Notes |
| -------------------------------------------------- | -------------------------------------------------------- | ----------------------------------- | ---- | ----- |
| `project_create(repo, namespace, description)`     | `POST /user/repos`, `/orgs/{o}/repos`                    | `POST /projects`                    | S    |       |
| `list_projects(namespace, user, search, language)` | `/user/repos`, `/orgs/{o}/repos`, `/search/repositories` | `/projects`, `/groups/:id/projects` | M    |       |
| project `delete`, `description` setter             | `DELETE`/`PATCH /repos`                                  | `DELETE`/`PUT /projects/:id`        | S    |       |
| `get_group`                                        | `/orgs/{o}`                                              | `/groups/:id`                       | S    |       |
| `GitUser.get_email`, `get_projects`, `get_forks`   | `/user/emails`, `/user/repos`                            | `/user`, `/users/:id/projects`      | S    |       |

### 2g. Comments, reactions and commit comments

| ogr                                                                             | GitHub                            | GitLab                              | Size | Notes                                                            |
| ------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------- | ---- | ---------------------------------------------------------------- |
| `Comment.get_reactions`, `add_reaction`, `Reaction.delete`                      | `/issues/comments/{id}/reactions` | `/notes/:id/award_emoji`            | M    | The emoji names differ (`+1` versus `thumbsup`); normalize them. |
| `commit_comment`, `get_commit_comments`, `get_commit_comment` → `CommitComment` | `/commits/{sha}/comments`         | `/repository/commits/:sha/comments` | M    | GitLab commit comments have no IDs.                              |
| `CommitFlag.edited`                                                             | `updated_at`                      | `finished_at`                       | S    |                                                                  |

### 2h. Authentication

| ogr                                                          | GitHub                   | GitLab                                | Size | Notes                                                                                                                        |
| ------------------------------------------------------------ | ------------------------ | ------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `set_auth_method`, `change_token`, `reset_auth_method`       |                          |                                       | S    | Token swapping on a live service.                                                                                            |
| GitHub App auth (`github_app`), `GithubAppNotInstalledError` | JWT → installation token | none                                  | L    | Needs JWT signing and token caching. `@octokit/auth-app` would be the only Octokit dependency, or write the signing by hand. |
| GitLab CI job token, OAuth                                   | none                     | `JOB-TOKEN` header; limited endpoints | S    | Record which operations a job token can call.                                                                                |
| `tokman`                                                     |                          |                                       | none | Packit infrastructure; out of scope.                                                                                         |

## Phase 3: More forges

| Forge           | In ogr | Spec                              | Size | Notes                                                                                                                                                                          |
| --------------- | ------ | --------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forgejo / Gitea | ✓      | Swagger 2.0 at `/swagger.v1.json` | L    | Convert to OpenAPI 3 in `specs:update`, for example with `swagger2openapi`. Codeberg is a live test instance. The API is modeled on GitHub's, so many mappers will be similar. |
| Pagure          | ✓      | none                              | L    | Types would have to be written by hand, which breaks the OpenAPI-first approach. **Not planned** unless someone asks for it.                                                   |
| Bitbucket Cloud | ✗      | OpenAPI published                 | L    | Beyond ogr. Only if there's demand.                                                                                                                                            |

## Phase 4: Beyond ogr

Things the target tools need that ogr doesn't do.

| Item                                | Size | Notes                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normalized webhook and CI events    | L    | For example, a comment-created event from a GitHub Actions payload or a GitLab note hook / `TRIGGER_PAYLOAD`. This is what comment-rollup needs to run on GitLab. Both forges publish webhook schemas: GitHub's are in the OpenAPI description, and GitLab's are documented. |
| GitHub Discussions                  | M    | GraphQL only, so it's outside the OpenAPI approach. GitLab has no equivalent, so it would throw `OperationNotSupported` there.                                                                                                                                               |
| A GitHub-shaped compatibility layer | M    | An Octokit-shaped wrapper over interforge, for tools that won't be rewritten.                                                                                                                                                                                                |

## Release readiness

These are needed before anything is public.

- [ ] Pick the name, and talk to the Packit maintainers about the relationship with ogr.
- [ ] Semantic versioning, a changelog, and npm provenance.
- [ ] API docs (TypeDoc) and a table of each forge's differences.
- [ ] Nightly live-verification job against the scratch repos, with tokens held as repository secrets.
- [ ] Decide on CommonJS support (currently ESM only).
