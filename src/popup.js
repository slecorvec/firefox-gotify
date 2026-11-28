// Shows the latest messages, unread ones highlighted, filterable by application, then
// marks everything read. Messages can be deleted on the server, one by one or all at once.
"use strict";

const SHOWN = 30;
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // text only: message content is never parsed as HTML
  return e;
}

// An <img> for an http(s) image URL, sending no referrer; hidden if it fails to load
// rather than showing a broken image.
function picture(cfg, cls, url) {
  const img = el("img", cls);
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => { img.hidden = true; });
  imageSrc(cfg, url).then((src) => { img.src = src; }, () => { img.hidden = true; });
  return img;
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

// Deletion happens on the server: the message is gone for every client of this user
// (phone included), hence the confirmation before deleting more than one.
function setupDelete(cfg, messages, lastReadId, appName) {
  const refresh = () => {
    const selected = $("app").value;
    renderFilter(messages, lastReadId, appName);
    $("app").value = [...$("app").options].some((o) => o.value === selected) ? selected : "";
    applyFilter($("app").value);
    $("clear").hidden = !messages.length;
    if (!messages.length) $("status").textContent = "No message to show.";
    browser.runtime.sendMessage({ type: "poll" }); // badge without the deleted messages
  };
  const drop = (keep) => {
    for (const m of messages.filter((x) => !keep(x))) {
      $("list").querySelector(`li[data-id="${m.id}"]`)?.remove();
      browser.notifications.clear(`gotify-${m.id}`);
    }
    messages.splice(0, messages.length, ...messages.filter(keep));
    refresh();
  };
  const fail = (e) => { $("status").textContent = `Error: ${e.message}`; };
  const ready = allowDeletes(cfg);

  $("list").addEventListener("click", async (ev) => {
    const li = ev.target.closest("button.delete")?.closest("li");
    if (!li) return;
    const id = Number(li.dataset.id);
    try {
      await ready;
      await api(cfg, `/message/${id}`, "DELETE");
      drop((m) => m.id !== id);
    } catch (e) { fail(e); }
  });

  $("clear").hidden = !messages.length;
  $("clear").onclick = () => {
    const app = $("app").value;
    $("confirm-text").textContent = app
      ? `Delete every message of ${appName(Number(app))} on the server?`
      : "Delete every message on the server?";
    $("confirm").hidden = false;
    $("confirm-no").focus();
  };
  $("confirm-no").onclick = () => { $("confirm").hidden = true; };
  $("confirm-yes").onclick = async () => {
    $("confirm").hidden = true;
    const app = $("app").value;
    try {
      await ready;
      await api(cfg, app ? `/application/${app}/message` : "/message", "DELETE");
      drop((m) => app !== "" && String(m.appid) !== app);
    } catch (e) { fail(e); }
  };
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
    const byId = new Map(apps.map((a) => [a.id, a]));
    const appName = (id) => byId.get(id)?.name ?? `app ${id}`;
    $("summary").textContent = unread.length ? `${unread.length}${unreadPage.complete ? "" : "+"} unread` : "No unread message";
    if (!messages.length) $("status").textContent = "No message on the server.";

    for (const m of messages) {
      const li = el("li", m.id > lastReadId ? "unread" : "");
      li.dataset.app = String(m.appid);
      li.dataset.id = String(m.id);
      const head = el("div", "head");
      const del = el("button", "delete", "×");
      del.type = "button";
      del.title = "Delete this message";
      del.setAttribute("aria-label", "Delete this message");
      const icon = appImageUrl(cfg, byId.get(m.appid));
      if (icon) head.append(picture(cfg, "app-icon", icon));
      head.append(el("span", "app", appName(m.appid)),
                  el("time", "", new Date(m.date).toLocaleString()), del);
      li.append(head);
      if (m.title) li.append(el("div", "title", m.title));
      const body = el("div", "body");
      body.append(linkify(String(m.message ?? ""), openTab));
      li.append(body);
      const big = bigImageUrl(m);
      if (big) li.append(picture(cfg, "picture", big));
      $("list").append(li);
    }
    renderFilter(messages, lastReadId, appName);
    $("app").onchange = () => { $("confirm").hidden = true; applyFilter($("app").value); };
    setupDelete(cfg, messages, lastReadId, appName);
    if (messages.length) browser.runtime.sendMessage({ type: "markRead", id: messages[0].id });
  } catch (e) {
    $("status").textContent = `Error: ${e.message}`;
  }
}

render();
