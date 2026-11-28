# Security review — 2026-11

Review of `src/` at commit `32c7367` (master after #5, #6, #7: message deletion,
application icons and attached pictures), before the 1.0.0 release. Method: an
independent read-only code review against the threat model below, then each finding
re-checked by hand (a measurement, a test against a real Gotify 3.1.1 server, or a
trace in the code) before being fixed, accepted or refuted. Fixes come with tests
(`test/unit/`, property-based, and the end-to-end suite).

**Verdict: no high or medium severity issue.** The client token cannot reach another
host, and server data cannot become HTML, script, CSS or a non-http(s) URL. One
low-severity denial of service was confirmed and fixed, along with robustness issues.

## Threat model

- **Untrusted content.** Anything that can push to the Gotify server (any application
  token, so any script or service the user connected) controls message titles, bodies,
  extras, and application names and icons.
- **Assets.** The client token (read and delete access to every message); the
  extension's pages (must not run foreign code); the user's attention (links and
  notification clicks must not mislead); the browser's responsiveness.
- **Out of scope.** A malicious Gotify server (it already holds the token and every
  message), the Gotify server's own security, someone with access to the browser
  profile.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | Low | `trimUrl` was quadratic: a message of 200,000 `)` (Gotify accepts it, checked) froze the popup for minutes (6 s for 32,000, measured) | **Fixed**: linear, brackets counted once; property test against the old version, timing test |
| 2 | Low | Huge titles and bodies were rendered whole | **Fixed**: title cut at 200 characters, body at 10,000 in the popup; notification title at 200 |
| 3 | Low | A poll ending while the popup marked messages read could notify messages just read | **Fixed**: the read-modify-write of `lastReadId` / `lastNotifiedId` is serialised, and the poll re-reads the stored value |
| 4 | Low | Images on the server's origin were downloaded without size limit and cached without bound | **Fixed**: 2 MB per image, 100 cached |
| 5 | Low | A sender can make the browser load a picture (`bigImageUrl`) from any https host, at poll time for the notification icon: that host learns the user's IP address and when the browser is open | **Accepted, documented** (README, Security): it is the feature (Radarr posters); a setting to turn remote pictures off is a possible follow-up |
| 6 | Info | `https://bank.example@evil.example/` was turned into a link reading like the bank | **Fixed**: URLs with credentials are never links, click targets or images |
| 7 | Info | A right-to-left override character before a link could display it reversed | **Fixed**: links are bidi-isolated, left to right |
| 8 | Info | A non-array `/application` answer made `notify` throw after `lastNotifiedId` was saved: notifications lost | **Fixed**: non-arrays treated as no application |
| 9 | Info | `markRead` with a missing id would store `NaN` | **Fixed**: ignored unless a safe integer |
| 10 | Info | The deleted message's `<li>` was found with a selector built from the server's id | **Fixed**: id → element map |
| 11 | Info | A notification's click target (any http(s) URL) is not shown before the click | **Accepted**: same as Gotify's own clients |
| 12 | Info | The host permission and the `Origin`-removal rule cover every port of the server's host | **Accepted**: Firefox match patterns carry no port; the rule only touches this extension's own DELETE requests |
| 13 | Info | The ESLint ban on HTML-parsing APIs does not catch computed property names | **Accepted**: a guard for reviews, not a proof |
| H1 | — | Gotify reusing message ids after a deletion would hide a new message | **Refuted**: tested on Gotify 3.1.1, ids keep increasing after deleting the newest message and after deleting all |

## Checked and sound

- All server text reaches the DOM through `textContent`; no HTML-parsing API in `src/`.
- Links and notification click targets go through `new URL()` and only http(s) passes.
- The token is sent only by `api()`, in the `X-Gotify-Key` header, to the configured
  server, with `redirect: "error"` and `credentials: "omit"`; never logged, never in a
  URL.
- Application icon paths cannot change the host (`${server}/${path}`: `..`, `//evil`,
  `@evil` and absolute URLs all resolve on the server).
- Image downloads never carry the token, refuse redirects and anything but `image/*`;
  SVG in `<img>` or a notification icon runs no script.
- The `declarativeNetRequest` rule only removes `Origin`, on this extension's own DELETE
  requests to the server's host, for the browser session; web pages and other
  extensions are unaffected.
- CSP: `script-src 'self'`, no inline code; broad `connect-src` / `img-src` matter only
  if script injection existed.
- Permissions: no content script, no `tabs`, no `webRequest`; host access requested at
  runtime for one host, the previous host revoked when it changes.
- Only the extension's own pages can message the background script.
- A server reset or mass deletion only lowers the stored read state: no unread message
  can be lost.

## Reproduce

```sh
npm ci --ignore-scripts && npm run test:unit      # properties, incl. the trimUrl timing
docker compose -f test/e2e/compose.yml up --build --abort-on-container-exit --exit-code-from e2e
```
