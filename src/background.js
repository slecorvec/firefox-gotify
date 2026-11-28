// Polls Gotify every <interval> minutes (alarms survive suspend and the event page being
// unloaded), keeps the badge = messages newer than the last read one, notifies new messages.
"use strict";

const MAX_NOTIFICATIONS = 3; // per poll; more → one summary notification

function setBadge(text, color = "#d33", title = "Gotify") {
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
  browser.action.setTitle({ title });
}

// Read-modify-write sections of lastReadId / lastNotifiedId run one at a time, so a
// markRead from the popup and the end of a poll cannot overwrite each other.
let stateLock = Promise.resolve();
function withState(fn) {
  const run = stateLock.then(fn);
  stateLock = run.catch(() => {});
  return run;
}

// One poll at a time; a request arriving during a poll (markRead, new settings) runs
// one more poll afterwards, so the result always reflects the latest stored state.
let running = null;
let again = false;
function poll() {
  if (running) { again = true; return running; }
  running = (async () => {
    do { again = false; await doPoll(); } while (again);
  })().finally(() => { running = null; });
  return running;
}

async function doPoll() {
  const cfg = await getConfig();
  if (!cfg.url || !cfg.token) return setBadge("?", "#888", "Gotify: set the server in the options");
  if (!(await browser.permissions.contains({ origins: [originPattern(cfg.url)] })))
    return setBadge("!", "#888", "Gotify: grant access to the server in the options");
  try {
    let { lastReadId, lastNotifiedId } = await browser.storage.local.get(["lastReadId", "lastNotifiedId"]);
    const newest = await latestId(cfg);
    // First run on this server: start from now, don't replay the whole history.
    // Newest id below the last read one: the server's database was reset — restart too.
    if (lastReadId === undefined || newest < lastReadId) {
      lastReadId = lastNotifiedId = newest;
      await browser.storage.local.set({ lastReadId, lastNotifiedId });
    }
    const { messages, complete } = await messagesAfter(cfg, lastReadId);
    const n = messages.length;
    setBadge(n ? (complete ? String(n) : "999+") : "", "#d33", `Gotify: ${n}${complete ? "" : "+"} unread`);

    // lastNotifiedId re-read now: the popup may have marked messages read meanwhile
    const fresh = await withState(async () => {
      const { lastNotifiedId: now = 0 } = await browser.storage.local.get("lastNotifiedId");
      const out = messages.filter((m) => m.id > Math.max(lastNotifiedId ?? 0, now)).reverse(); // oldest first
      // saved first: an unload in between loses a notification rather than repeating it
      if (out.length) await browser.storage.local.set({ lastNotifiedId: Math.max(now, out.at(-1).id) });
      return out;
    });
    if (fresh.length) await notify(cfg, fresh);
  } catch (e) {
    setBadge("err", "#888", `Gotify: ${e.message}`);
  }
}

// Where a click on a message's notification leads: the message's own click URL
// (extras client::notification.click.url) when it is http(s), else the Gotify web UI.
// Kept in storage.session: the event page may be unloaded before the click.
function clickUrl(m) {
  const raw = m.extras?.["client::notification"]?.click?.url;
  return typeof raw === "string" ? safeHttpUrl(raw) : null;
}

// Notification icon: the picture attached to the message, else its application's icon,
// else the extension's bell. Firefox only has "basic" notifications: a picture can only
// be shown as the icon.
async function notify(cfg, fresh) {
  const shown = fresh.length > MAX_NOTIFICATIONS ? [] : fresh;
  const answer = shown.length ? await api(cfg, "/application").catch(() => []) : [];
  const apps = Array.isArray(answer) ? answer : [];
  const icon = async (m) => {
    const url = bigImageUrl(m) ?? appImageUrl(cfg, apps.find((a) => a.id === m.appid));
    return url ? imageSrc(cfg, url).catch(() => "icons/bell-96.png") : "icons/bell-96.png";
  };
  const targets = Object.fromEntries(shown.map((m) => [`gotify-${m.id}`, clickUrl(m)]).filter(([, u]) => u));
  if (Object.keys(targets).length) browser.storage.session.set(targets);
  for (const m of shown) {
    browser.notifications.create(`gotify-${m.id}`, {
      type: "basic",
      iconUrl: await icon(m),
      title: String(m.title ?? "").slice(0, 200) || "Gotify",
      message: String(m.message ?? "").slice(0, 500),
    });
  }
  if (!shown.length) {
    browser.notifications.create("gotify-summary", {
      type: "basic",
      iconUrl: "icons/bell-96.png",
      title: "Gotify",
      message: `${fresh.length} new messages`,
    });
  }
}

browser.notifications.onClicked.addListener(async (id) => {
  const { [id]: target } = await browser.storage.session.get(id); // before clear(): onClosed drops it
  browser.notifications.clear(id);
  const { url } = await getConfig();
  const open = target || url;
  if (open) browser.tabs.create({ url: open });
});
browser.notifications.onClosed.addListener((id) => browser.storage.session.remove(id));

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "markRead" && Number.isSafeInteger(msg.id)) {
    await withState(async () => {
      const { lastReadId = 0, lastNotifiedId = 0 } = await browser.storage.local.get(["lastReadId", "lastNotifiedId"]);
      await browser.storage.local.set({ lastReadId: Math.max(lastReadId, msg.id), lastNotifiedId: Math.max(lastNotifiedId, msg.id) });
    });
  }
  if (msg?.type === "settings") return schedule();
  if (msg?.type === "markRead" || msg?.type === "poll") await poll();
});

async function schedule() {
  const { interval } = await getConfig();
  // create() replaces the alarm of the same name: a new interval takes effect at once
  browser.alarms.create("poll", { periodInMinutes: interval, delayInMinutes: interval });
  await poll();
}
browser.alarms.onAlarm.addListener((a) => (a.name === "poll" ? poll() : undefined));
browser.runtime.onStartup.addListener(schedule);
browser.runtime.onInstalled.addListener(schedule);
// Re-enabling the add-on fires neither event and its alarms are gone: re-arm here.
browser.alarms.get("poll").then((a) => a || schedule());
