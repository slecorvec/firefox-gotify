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

// An application's icon on the server (Gotify serves them without authentication).
function appImageUrl(cfg, app) {
  return typeof app?.image === "string" ? safeHttpUrl(`${cfg.url}/${app.image}`) : null;
}

// A picture the sender attached to a message (extras client::notification.bigImageUrl,
// e.g. a Radarr or Sonarr poster), http(s) only. It may live on any host.
function bigImageUrl(m) {
  const raw = m.extras?.["client::notification"]?.bigImageUrl;
  return typeof raw === "string" ? safeHttpUrl(raw) : null;
}

// An image as extension pages and notifications can show it. Firefox upgrades http
// images to https on extension pages, which a plain-http Gotify server does not answer:
// images on the server itself (reachable with the host permission) are downloaded
// (no token: Gotify serves them publicly) and handed over as a data: URL. Images on
// other hosts are left to load directly, which works over https.
const imageCache = new Map();
function imageSrc(cfg, url) {
  if (new URL(url).origin !== new URL(cfg.url).origin) return Promise.resolve(url);
  if (!imageCache.has(url)) imageCache.set(url, (async () => {
    const res = await fetch(url, {
      credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw new Error(`${url}: not an image`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  })().catch((e) => { imageCache.delete(url); throw e; }));
  return imageCache.get(url);
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

// Calls a Gotify API path (GET unless told otherwise) with the client token in a header
// (never in the URL: query strings end up in server and proxy access logs). Returns the
// JSON answer of a GET, nothing for other methods.
async function api(cfg, path, method = "GET") {
  const res = await fetch(cfg.url + path, {
    method,
    headers: { "X-Gotify-Key": cfg.token },
    cache: "no-store",
    credentials: "omit",
    redirect: "error", // a redirect would carry the X-Gotify-Key header to another server
    signal: AbortSignal.timeout(15000), // a hung request must not freeze the poll loop
  }).catch((e) => {
    throw new Error(`${path.split("?")[0]}: ${e.message} (server unreachable, or it redirects: use its final https URL)`);
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
  if (method !== "GET") return undefined;
  if (!res.headers.get("content-type")?.includes("json"))
    throw new Error(`${path.split("?")[0]}: not a Gotify answer (login page of a proxy in front?)`);
  return res.json();
}

// Firefox adds "Origin: moz-extension://…" to the extension's non-GET requests, and
// Gotify's CORS filter answers 403 to an origin it was not configured for. Dropping that
// header (only on this extension's DELETE requests to the server's host) turns them into
// plain non-CORS requests, which Gotify accepts: no CORS setting needed on the server.
async function allowDeletes(cfg) {
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
      condition: {
        requestDomains: [new URL(cfg.url).hostname],
        initiatorDomains: [location.hostname], // this extension's own pages only
        requestMethods: ["delete"],
        resourceTypes: ["xmlhttprequest"],
      },
    }],
  });
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
