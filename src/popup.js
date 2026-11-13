// Shows the latest messages, unread ones highlighted, then marks everything read.
"use strict";

const SHOWN = 30;
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // text only: message content is never parsed as HTML
  return e;
}

async function render() {
  const cfg = await getConfig();
  if (!cfg.url || !cfg.token) {
    $("status").textContent = "Set the server and token in the extension options.";
    return;
  }
  $("open").onclick = (ev) => { ev.preventDefault(); browser.tabs.create({ url: cfg.url }); window.close(); };
  try {
    const { lastReadId = Infinity } = await browser.storage.local.get("lastReadId");
    const [unreadPage, latest, apps] = await Promise.all([
      lastReadId === Infinity ? { messages: [], complete: true } : messagesAfter(cfg, lastReadId),
      api(cfg, `/message?limit=${SHOWN}`),
      api(cfg, "/application"),
    ]);
    // every unread message is shown before being marked read; read ones fill up to SHOWN
    const unread = unreadPage.messages;
    const messages = unread.length >= SHOWN ? unread : unread.concat(latest.messages.filter((m) => m.id <= lastReadId)).slice(0, SHOWN);
    const appName = new Map(apps.map((a) => [a.id, a.name]));
    $("summary").textContent = unread.length ? `${unread.length}${unreadPage.complete ? "" : "+"} unread` : "No unread message";
    if (!messages.length) $("status").textContent = "No message on the server.";

    for (const m of messages) {
      const li = el("li", m.id > lastReadId ? "unread" : "");
      const head = el("div", "head");
      head.append(el("span", "app", appName.get(m.appid) ?? `app ${m.appid}`),
                  el("time", "", new Date(m.date).toLocaleString()));
      li.append(head);
      if (m.title) li.append(el("div", "title", m.title));
      li.append(el("div", "body", m.message));
      $("list").append(li);
    }
    if (messages.length) browser.runtime.sendMessage({ type: "markRead", id: messages[0].id });
  } catch (e) {
    $("status").textContent = `Error: ${e.message}`;
  }
}

render();
