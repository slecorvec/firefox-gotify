# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security → [Report a vulnerability](https://github.com/slecorvec/firefox-gotify/security/advisories/new)**
on this repository. Do not open a public issue.

What to expect:

- an acknowledgement within **7 days**;
- an assessment (accepted or not, and why) within **30 days**;
- for an accepted report, a fix released as soon as possible, then a published GitHub
  security advisory crediting you (unless you prefer not to be named);
- coordinated disclosure: please keep the details private until the fix is released,
  or 90 days after your report, whichever comes first.

## Supported versions

Only the latest release, and `master`, receive security fixes.

## Scope

In scope: anything that lets content pushed to a Gotify server (message title, body,
extras, application names, images) run code, alter the extension's pages, open a
non-http(s) URL, or that leaks the client token anywhere else than the configured
server; and anything that lets a web page or another extension use the extension's
access to the Gotify server.

Out of scope: the Gotify server itself (report to the
[Gotify project](https://github.com/gotify/server/security)), and what a person with
access to the browser profile can already do.
