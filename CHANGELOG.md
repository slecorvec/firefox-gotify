# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/).

## 0.2.0 — unreleased

### Added

- Configurable poll interval (1–1440 minutes).
- Popup filter by application, with unread counts.
- Clickable http(s) links in messages.
- Application icons in the popup and as notification icons; pictures attached to
  messages (`bigImageUrl` extra, e.g. Radarr posters) in the popup and notifications.
- Delete messages from the popup: one, every message of the filtered application, or all.
- Notification click opens the message's `client::notification.click.url` (http(s) only).
- Strict Content-Security-Policy on the extension pages; API requests refuse redirects.
- End-to-end test (real Gotify server, headless Firefox ESR), CI (MegaLinter, gitleaks),
  OpenSSF Scorecard.

### Changed

- The extension's description says it is an unofficial Gotify client.

## 0.1.0

- First version: polling, unread badge, desktop notifications, popup.
