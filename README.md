<!-- markdownlint-disable-next-line MD041 -->
> [!WARNING]
>
> ## 🚧 WORK IN PROGRESS (WIP) 🚧
>
> Not released yet: features, options and stored data may still change without notice.

# Gotify Unread — Firefox extension

[![CI](https://github.com/slecorvec/firefox-gotify/actions/workflows/ci.yml/badge.svg)](https://github.com/slecorvec/firefox-gotify/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/slecorvec/firefox-gotify/badge)](https://scorecard.dev/viewer/?uri=github.com/slecorvec/firefox-gotify)
[![License: 0BSD](https://img.shields.io/badge/license-0BSD-blue.svg)](LICENSE)

Firefox extension for [Gotify](https://gotify.net): an unread badge counting every
message received since you last opened it — including those sent while the browser was
closed — desktop notifications, clickable links and a per-application filter.

## Features

Checked by the end-to-end test ([`test/e2e/`](test/e2e/extension.test.mjs)) against a
real Gotify server and the real extension in Firefox, except the parts marked *(not
e2e-tested)*.

- **Any Gotify server**: server URL and client token set in the options, connection
  tested on save (warning when the token would travel over plain http).
- **Polling at a configurable interval** (1 minute by default, 1–1440): `GET /message`.
  *Not e2e-tested*: the default and bounds, the client token sent in the `X-Gotify-Key`
  header and never in the URL, redirects refused. Polling rather than a
  WebSocket: it survives sleep, network changes and server restarts with no reconnect
  logic. First run starts from now: the server's history is not replayed.
- **Unread badge** = messages newer than the last one you saw; "999+" from 1000 on
  *(not e2e-tested)*.
- **Desktop notification** for each new message (one summary beyond 3 at once).
  Clicking it opens the message's own click URL (`client::notification.click.url`
  extra) when it is http(s), the Gotify web UI otherwise (the test checks the URL kept
  for the click; the click itself is *not e2e-tested*: a desktop notification cannot be
  clicked from WebDriver).
- **Popup**: messages since your last opening highlighted, then marked read; filter
  by application, with each application's unread count. The filter resets at each
  opening: opening marks every application read, a remembered filter would hide the
  others' new messages.
- **Clickable links**: http(s) URLs in a message open in a new tab; the link shows the
  normalised URL it opens (an internationalised host appears as punycode).

## Security

Messages come from whatever can push to your Gotify server: the extension treats
them as untrusted.

- Message title and body are rendered as **text only**: no HTML, no Markdown rendering,
  no `innerHTML` (an ESLint rule forbids the HTML-parsing DOM APIs in the code).
- Only `http:` / `https:` URLs become links or notification targets — `javascript:`,
  `data:`, `file:`… are left as plain text. Links carry `rel="noopener noreferrer"`.
- Strict Content-Security-Policy on the extension pages: scripts and styles from the
  extension only, no inline code, no remote code.
- Host access is requested at runtime for **your server's host only** (no CORS
  setting needed on the Gotify side); the token is stored in the extension's local
  storage and sent to that server only.
- No dependency at runtime, no build step: the published code is the code in `src/`.
- Nothing leaves your browser except the requests to your own Gotify server.

Reporting a vulnerability: see [SECURITY.md](SECURITY.md).

## Install (development)

1. In Gotify: Clients → Create client, copy the token.
2. Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick
   `src/manifest.json`. A temporary add-on is removed when Firefox restarts: the
   "messages sent while Firefox was closed" behaviour needs a signed build.
3. Extension options: server URL, token, poll interval → Save and test (accept the
   host permission).

## Development

The extension is plain JavaScript (Manifest V3, Firefox ≥ 140) with no build step.

```sh
# web-ext lint + end-to-end test: Gotify server + headless Firefox ESR, in Docker
docker compose -f test/e2e/compose.yml up --build --abort-on-container-exit --exit-code-from e2e
docker compose -f test/e2e/compose.yml down -v
```

CI ([`.github/workflows/`](.github/workflows/)) runs on every push to master and every
pull request:
[MegaLinter](https://megalinter.io) (ESLint, Stylelint, HTMLHint, JSONLint, markdownlint,
yamllint, actionlint, hadolint, secretlint, Trivy), [gitleaks](https://github.com/gitleaks/gitleaks)
on the full history, and the end-to-end test. Actions are pinned by commit SHA;
[OpenSSF Scorecard](https://scorecard.dev) grades the supply chain weekly.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[0BSD](LICENSE) — do whatever you want with it.
