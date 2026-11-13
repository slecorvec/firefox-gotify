// Shared by the background script, the popup and the options page.
"use strict";

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // unread count is exact up to 1000 messages, "999+" beyond
const DEFAULT_INTERVAL = 1; // minutes between polls
const MIN_INTERVAL = 1;
const MAX_INTERVAL = 1440;

function clampInterval(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n)) : DEFAULT_INTERVAL;
}

async function getConfig() {
  const { url = "", token = "", interval = DEFAULT_INTERVAL } =
    await browser.storage.local.get(["url", "token", "interval"]);
  return { url: url.replace(/\/+$/, ""), token, interval: clampInterval(interval) };
}

// An http(s) URL taken from server data (message text, extras), or null: anything
// else (javascript:, data:, file:, moz-extension:…) is never opened nor turned into a link.
function safeHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

// Message text → DOM nodes: text nodes, plus <a> for http(s) URLs. No HTML parsing
// anywhere (no innerHTML, no markdown rendering): a message can only ever be text and
// links. onOpen(url) is called on click; the anchor has no target of its own.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const CLOSERS = { ")": "(", "]": "[", "}": "{" };

// Drops sentence punctuation glued to a URL, and a closing bracket only when it has no
// opening one inside the URL: "(see https://x.org/a)" vs "https://x.org/Foo_(bar)".
function trimUrl(raw) {
  for (;;) {
    const ch = raw.at(-1);
    const open = CLOSERS[ch];
    if (".,;:!?".includes(ch)) raw = raw.slice(0, -1);
    else if (open && raw.split(open).length <= raw.split(ch).length - 1) raw = raw.slice(0, -1);
    else return raw;
  }
}

function linkify(text, onOpen) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = trimUrl(match[0]);
    const href = safeHttpUrl(raw);
    if (!href) continue;
    frag.append(text.slice(last, match.index));
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener noreferrer";
    a.textContent = href; // normalised: an IDN host shows as punycode, as it will be opened
    a.addEventListener("click", (ev) => { ev.preventDefault(); onOpen(href); });
    frag.append(a);
    last = match.index + raw.length;
  }
  frag.append(text.slice(last));
  return frag;
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
    redirect: "error", // a redirect would carry the X-Gotify-Key header to another server
    signal: AbortSignal.timeout(15000), // a hung request must not freeze the poll loop
  }).catch((e) => {
    throw new Error(`${path.split("?")[0]}: ${e.message} (server unreachable, or it redirects: use its final https URL)`);
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
