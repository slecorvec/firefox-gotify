// Shows the latest messages, unread ones highlighted, filterable by application, then
// marks everything read.
"use strict";

const SHOWN = 30;
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // text only: message content is never parsed as HTML
  return e;
}

function openTab(url) {
  browser.tabs.create({ url });
  window.close();
}

// Application filter: a <select> listing the applications present in the shown
// messages, with their unread count. Not remembered: opening the popup marks every
// application read, so a filter kept from last time would hide other applications' news.
function renderFilter(messages, lastReadId, appName) {
  const counts = new Map();
  for (const m of messages) {
    const c = counts.get(m.appid) ?? { unread: 0 };
    if (m.id > lastReadId) c.unread++;
    counts.set(m.appid, c);
  }
  const select = $("app");
  select.replaceChildren(el("option", "", "All applications"));
  select.firstChild.value = "";
  const ids = [...counts.keys()].sort((a, b) => appName(a).localeCompare(appName(b)));
  for (const id of ids) {
    const { unread } = counts.get(id);
    const opt = el("option", "", unread ? `${appName(id)} (${unread})` : appName(id));
    opt.value = String(id);
    select.append(opt);
  }
  select.hidden = counts.size < 2;
}

function applyFilter(selected) {
  for (const li of $("list").children) li.hidden = selected !== "" && li.dataset.app !== selected;
}

async function render() {
  const cfg = await getConfig();
  if (!cfg.url || !cfg.token) {
    $("status").textContent = "Set the server and token in the extension options.";
    return;
  }
  $("open").onclick = (ev) => { ev.preventDefault(); openTab(cfg.url); };
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
    const names = new Map(apps.map((a) => [a.id, a.name]));
    const appName = (id) => names.get(id) ?? `app ${id}`;
    $("summary").textContent = unread.length ? `${unread.length}${unreadPage.complete ? "" : "+"} unread` : "No unread message";
    if (!messages.length) $("status").textContent = "No message on the server.";

    for (const m of messages) {
      const li = el("li", m.id > lastReadId ? "unread" : "");
      li.dataset.app = String(m.appid);
      const head = el("div", "head");
      head.append(el("span", "app", appName(m.appid)),
                  el("time", "", new Date(m.date).toLocaleString()));
      li.append(head);
      if (m.title) li.append(el("div", "title", m.title));
      const body = el("div", "body");
      body.append(linkify(String(m.message ?? ""), openTab));
      li.append(body);
      $("list").append(li);
    }
    renderFilter(messages, lastReadId, appName);
    $("app").onchange = () => applyFilter($("app").value);
    if (messages.length) browser.runtime.sendMessage({ type: "markRead", id: messages[0].id });
  } catch (e) {
    $("status").textContent = `Error: ${e.message}`;
  }
}

render();
