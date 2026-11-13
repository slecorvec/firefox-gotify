# Gotify Unread — Firefox extension

Firefox extension for [Gotify](https://gotify.net): an unread badge counting every
message received since you last read them — including those sent while the browser was
closed — and a desktop notification for each new message.

## How it works

- Polls the server every minute (`GET /message`, client token sent in the
  `X-Gotify-Key` header, never in the URL). Polling instead of a WebSocket: it survives
  sleep, network changes and server restarts with no reconnect logic.
- Badge = messages newer than the last one you read. Opening the popup lists the
  latest messages (unread ones highlighted) and marks everything read.
- New messages raise a notification (one summary beyond 3 at once); clicking it opens
  the Gotify web UI.
- Host access is requested for your server's origin only, so no CORS setting is needed
  on the Gotify side.
- Nothing leaves your browser except the requests to your own Gotify server.

## Install (development)

1. In Gotify: Clients → Create client, copy the token.
2. Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick
   `src/manifest.json`. A temporary add-on is removed when Firefox restarts: the
   "messages sent while Firefox was closed" behaviour needs a signed build.
3. Extension options: server URL + token → Save and test (accept the host permission).

## License

[0BSD](LICENSE) — do whatever you want with it.
