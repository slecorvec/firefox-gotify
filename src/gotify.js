// Shared by the background script, the popup and the options page.
"use strict";

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // unread count is exact up to 1000 messages, "999+" beyond

async function getConfig() {
  const { url = "", token = "" } = await browser.storage.local.get(["url", "token"]);
  return { url: url.replace(/\/+$/, ""), token };
}

// The server origin as a host-permission pattern: "https://gotify.example.com/*".
// Match patterns carry no port: the grant covers the host on any port.
function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

// GET a Gotify API path with the client token in a header (never in the URL: query
// strings end up in server and proxy access logs).
async function api(cfg, path) {
  const res = await fetch(cfg.url + path, {
    headers: { "X-Gotify-Key": cfg.token },
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(15000), // a hung request must not freeze the poll loop
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
  if (!res.headers.get("content-type")?.includes("json"))
    throw new Error(`${path.split("?")[0]}: not a Gotify answer (login page of a proxy in front?)`);
  return res.json();
}

// Messages newer than afterId, newest first. Gotify pages backwards: ?since=<id>
// returns messages with an id lower than <id>.
async function messagesAfter(cfg, afterId) {
  const out = [];
  let since = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `/message?limit=${PAGE_SIZE}` + (since ? `&since=${since}` : "");
    const { messages } = await api(cfg, q);
    for (const m of messages) {
      if (m.id <= afterId) return { messages: out, complete: true };
      out.push(m);
    }
    if (messages.length < PAGE_SIZE) return { messages: out, complete: true };
    since = messages[messages.length - 1].id;
  }
  return { messages: out, complete: false };
}

async function latestId(cfg) {
  const { messages } = await api(cfg, "/message?limit=1");
  return messages.length ? messages[0].id : 0;
}
