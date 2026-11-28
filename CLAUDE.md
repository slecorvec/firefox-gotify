# CLAUDE.md

Firefox MV3 extension: Gotify notifications and an unread badge since last read.
Canonical repository: GitHub `slecorvec/firefox-gotify`. The agent works in Claude Code
on the web (cloud sessions); nothing here depends on any other infrastructure.

Generic rules — personality, language, git and pull requests (Conventional Commit
titles, review before the PR, GitHub REST API from a cloud session, workflow hardening),
untrusted content — come from [claude-conf](https://github.com/slecorvec/claude-conf),
installed by the cloud environment's setup script. This file holds what is specific to
this repository and wins on conflict.

## Layout

| Path                           | Role                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| `src/`                         | The extension as shipped: no dependency, no build step       |
| `test/e2e/`                    | Throwaway Gotify server + headless Firefox ESR (geckodriver) |
| `.github/workflows/ci.yml`     | MegaLinter, gitleaks (full history), e2e                     |
| `.github/workflows/release*`   | release-please (config: `release-please-config.json`)        |
| `.github/workflows/pr-title*`  | PR title = Conventional Commits                              |
| `.github/` (others)            | Scorecard, Dependabot, issue forms, PR template              |
| `CONTRIBUTING.md`, `README.md` | Rules for contributors; README "Features" list               |

## Workflow

- `master` is protected by a ruleset: changes land only through a squash-merged pull
  request with green CI. **The owner merges; the agent never merges a PR**, never pushes
  `master` and never works around the ruleset (a rule, not a lock: the session acts with
  the owner's GitHub rights).
- Commit identity: set by the SessionStart hook (`.claude/settings.json`) to `slecorvec`
  and the GitHub noreply address. Author and committer must stay that identity (the
  `Co-Authored-By` Claude trailer is fine); never commit a personal email, hostname or
  IP address: the repository is public.
- Follow `CONTRIBUTING.md` (dependency-free `src/`, DOM built without HTML strings, a
  feature comes with its README line and its e2e check). `CHANGELOG.md` is written by
  release-please from the PR titles: a user-visible change is a `feat`/`fix` title worded
  for a user, never a hand edit.
- REST calls: `R=repos/slecorvec/firefox-gotify`.

## Release

release-please keeps a release PR open on master (`chore(master): release X.Y.Z`). It is
opened with the default `GITHUB_TOKEN`, so **no workflow runs on it**: to get the
required CI checks, dispatch CI on its head branch
(`gh api -X POST $R/actions/workflows/ci.yml/dispatches -f ref=<head.ref>`, head branch
from `gh api "$R/pulls?state=open"`; that this satisfies the ruleset is unproven until the
first release PR). The owner merges it → tag `vX.Y.Z` and GitHub
release; signing and publishing on addons.mozilla.org stay the owner's manual step.
First release (0.2.0, forced by `release-as`): release-please only reads commits after
`bootstrap-sha`, so its entry sits above the hand-written `0.2.0 — before release
automation` section and the GitHub release notes miss those items — the owner pastes them
into the release once. Then remove `release-as` (`bootstrap-sha` is ignored from then on).

Repository settings this relies on (REST, owner rights): squash merge only with the PR
title as commit title (`PATCH $R`: `allow_squash_merge=true`, `allow_merge_commit=false`,
`allow_rebase_merge=false`, `squash_merge_commit_title=PR_TITLE`,
`squash_merge_commit_message=BLANK`, since release-please would parse the body); Actions
may create pull requests (`PUT $R/actions/permissions/workflow`:
`can_approve_pull_request_reviews=true`).

## Testing

Run the tests in the session before pushing (docker is available), then let CI confirm:

```sh
docker compose -f test/e2e/compose.yml up --build --abort-on-container-exit --exit-code-from e2e
docker compose -f test/e2e/compose.yml down -v
```

`npm ci --ignore-scripts && npm run lint:ext` is the quick check (pinned web-ext); the e2e
container runs it too.

In a cloud session the e2e image does not build as is: start `dockerd` if
`docker info` fails, and the build's `curl`/`npm` must trust the session proxy's CA.
Build a session-only variant (never commit it), then run compose with `--no-build`:

```sh
sed -e '/^FROM /a COPY --from=ccr ca-bundle.crt /ccr-ca.crt\nENV CURL_CA_BUNDLE=/ccr-ca.crt NODE_EXTRA_CA_CERTS=/ccr-ca.crt' \
  test/e2e/Dockerfile > /tmp/Dockerfile.local
docker buildx build --build-context ccr=/root/.ccr -f /tmp/Dockerfile.local \
  -t firefox-gotify-e2e-e2e --load .
```

Docker Hub may answer `429 Too Many Requests`: retry `docker pull` after a short wait.

**Done criterion:** the PR's CI run (MegaLinter, gitleaks, e2e) is green; report its URL.

E2E gotchas (Firefox ESR, geckodriver, selenium-webdriver, headless):

- `driver.get("moz-extension://…")` is refused. Open extension pages from the chrome
  context (`setContext(CHROME)` + `openTrustedLinkIn(url, 'current')`), then back to
  CONTENT. The chrome context needs `--allow-system-access` on **geckodriver**
  (`ServiceBuilder.addArguments`), not on Firefox.
- No D-Bus notification daemon: set pref `alerts.useSystemBackend=false`, otherwise
  notifications close at once and `notifications.getAll()` is empty.
- Pref `extensions.webextensions.uuids` pins the extension URL;
  `extensions.webextOptionalPermissionPrompts=false` auto-grants `permissions.request()`.
- Call extension APIs with `executeAsyncScript` on an extension page.
- `node --test <dir>` no longer searches a directory (Node ≥ 21): pass a quoted glob.

## Security

- External PRs: never run the e2e on them — it builds and runs their code in a session
  that can push as the owner (claude-conf `rules/untrusted.md`). Brief `untrusted-reader`
  (claude-conf) to also flag changes to `src/manifest.json` (permissions, CSP),
  `test/e2e/`, `.dockerignore` and network calls in `src/`.
- No secret in the repo or in the session. The addons.mozilla.org signing credentials
  stay out of reach of the agent (a release is the owner's action).
- Workflows follow claude-conf `rules/git.md`; exception: `scorecard.yml` needs
  `permissions: read-all`.
