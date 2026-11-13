// Polls Gotify every minute (alarms survive suspend and the event page being unloaded),
// keeps the badge = messages newer than the last read one, notifies new messages.
"use strict";

const POLL_MINUTES = 1;
const MAX_NOTIFICATIONS = 3; // per poll; more → one summary notification

function setBadge(text, color = "#d33", title = "Gotify") {
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
  browser.action.setTitle({ title });
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

    const fresh = messages.filter((m) => m.id > (lastNotifiedId ?? 0)).reverse(); // oldest first
    if (fresh.length) {
      // saved first: an unload in between loses a notification rather than repeating it
      await browser.storage.local.set({ lastNotifiedId: fresh[fresh.length - 1].id });
      notify(fresh);
    }
  } catch (e) {
    setBadge("err", "#888", `Gotify: ${e.message}`);
  }
}

function notify(fresh) {
  const shown = fresh.length > MAX_NOTIFICATIONS ? [] : fresh;
  for (const m of shown) {
    browser.notifications.create(`gotify-${m.id}`, {
      type: "basic",
      iconUrl: "icons/bell-96.png",
      title: m.title || "Gotify",
      message: m.message.slice(0, 500),
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
  browser.notifications.clear(id);
  const { url } = await getConfig();
  if (url) browser.tabs.create({ url });
});

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "markRead") {
    const { lastReadId = 0, lastNotifiedId = 0 } = await browser.storage.local.get(["lastReadId", "lastNotifiedId"]);
    await browser.storage.local.set({ lastReadId: Math.max(lastReadId, msg.id), lastNotifiedId: Math.max(lastNotifiedId, msg.id) });
  }
  if (msg?.type === "markRead" || msg?.type === "poll") await poll();
});

function schedule() {
  browser.alarms.create("poll", { periodInMinutes: POLL_MINUTES, delayInMinutes: POLL_MINUTES });
  poll();
}
browser.alarms.onAlarm.addListener((a) => { if (a.name === "poll") poll(); });
browser.runtime.onStartup.addListener(schedule);
browser.runtime.onInstalled.addListener(schedule);
// Re-enabling the add-on fires neither event and its alarms are gone: re-arm here.
browser.alarms.get("poll").then((a) => a || schedule());
