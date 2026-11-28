// End-to-end test of every feature listed in the README, against a real Gotify server
// and the real extension loaded in headless Firefox. Tests run in order and share
// state (one server, one browser profile), like a user going through the features.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const GOTIFY = process.env.GOTIFY_URL ?? "http://gotify";
const ADMIN = "Basic " + Buffer.from(`admin:${process.env.GOTIFY_ADMIN_PASS ?? "admin"}`).toString("base64");
const EXT_ID = "gotify-unread@slecorvec";
const EXT_UUID = "6f1c2a3e-0b7d-4e59-9a41-2d8f5c0e7b13"; // pinned so pages have a known URL
const EXT = `moz-extension://${EXT_UUID}`;
const SRC = path.resolve(import.meta.dirname, "../../src");

let driver;
let client; // Gotify client token, as a user would create in the web UI
const apps = {}; // name → { id, token }

async function gotify(method, url, { auth = ADMIN, body } = {}) {
  const headers = auth.startsWith("Basic ") ? { Authorization: auth } : { "X-Gotify-Key": auth };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(GOTIFY + url, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const push = (app, message, extra = {}) =>
  gotify("POST", "/message", { auth: apps[app].token, body: { message, priority: 5, ...extra } });

// Runs an async function body inside the current extension page (browser.* available).
async function ext(body, ...args) {
  const r = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     (async (...args) => { ${body} })(...Array.from(arguments).slice(0, -1))
       .then((v) => done({ v }), (e) => done({ e: String(e) }));`, ...args);
  if (r.e) throw new Error(r.e);
  return r.v;
}

// WebDriver may not navigate to moz-extension:// pages: load them from the browser
// chrome (system principal) into the current tab, then come back to the content.
async function openExt(page) {
  await driver.executeScript("window.__stale = true;"); // the old document, until replaced
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript("openTrustedLinkIn(arguments[0], 'current');", `${EXT}/${page}`);
  await driver.setContext(firefox.Context.CONTENT);
  await waitFor(`${page} loaded`, async () =>
    (await driver.getCurrentUrl()).startsWith(`${EXT}/${page}`) &&
    (await driver.executeScript("return !window.__stale && document.readyState === 'complete';")));
}

const badge = () => ext("return browser.action.getBadgeText({});");
const pollNow = () => ext('await browser.runtime.sendMessage({ type: "poll" });');

async function waitFor(what, fn, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${what} (last: ${last})`);
}

async function waitBadge(expected, timeout) {
  await waitFor(`badge "${expected}"`, async () => (await badge()) === expected, timeout);
}

async function saveOptions({ url, token, interval }) {
  await openExt("options.html");
  await driver.wait(until.elementLocated(By.css("body[data-ready]")), 15000); // stored values filled in
  for (const [id, value] of Object.entries({ url, token, interval })) {
    const input = await driver.findElement(By.id(id));
    await input.clear();
    await input.sendKeys(String(value));
  }
  await driver.findElement(By.css("button[type=submit]")).click();
  const status = await driver.findElement(By.id("status"));
  await driver.wait(async () => (await status.getText()) !== "", 15000);
  return status.getText();
}

before(async () => {
  await waitFor("Gotify server", async () => (await fetch(`${GOTIFY}/version`)).ok, 60000);
  for (const name of ["backups", "alerts"]) apps[name] = await gotify("POST", "/application", { body: { name } });
  client = (await gotify("POST", "/client", { body: { name: "e2e" } })).token;
  await push("backups", "sent before the extension was configured");

  const options = new firefox.Options()
    .addArguments("-headless")
    .setBinary(process.env.FIREFOX_BIN ?? "/usr/bin/firefox-esr")
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [EXT_ID]: EXT_UUID }))
    // grant optional host permissions without the doorhanger a user would click
    .setPreference("extensions.webextOptionalPermissionPrompts", false)
    // no D-Bus notification daemon in the container: Firefox's own alert windows, which
    // stay open long enough for notifications.getAll() to see them
    .setPreference("alerts.useSystemBackend", false);
  driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER ?? "/usr/local/bin/geckodriver")
      .addArguments("--allow-system-access")) // chrome context, for openExt()
    .build();
  await driver.installAddon(SRC, true);
});

after(async () => { await driver?.quit(); });

test("before configuration: the badge asks for the options", async () => {
  await openExt("options.html");
  await waitBadge("?");
});

test("connects to a Gotify server at a configurable URL", async () => {
  const status = await saveOptions({ url: GOTIFY, token: client, interval: 1 });
  assert.match(status, /Connected as admin\./);
  assert.match(status, /plain http/, "warns that a plain-http token travels unencrypted");
  const stored = await ext('return browser.storage.local.get(["url", "token", "interval"]);');
  assert.deepEqual(stored, { url: GOTIFY, token: client, interval: 1 });
});

test("first poll starts from now: the server's history is not replayed", async () => {
  await waitFor("poll result", async () => (await ext("return browser.action.getTitle({});")) === "Gotify: 0 unread");
  assert.equal(await badge(), "");
});

test("new messages: unread badge and one desktop notification each", async () => {
  const a = await push("backups", "Backup done, report at https://example.org/report?id=1. <b>bold</b><img src=x onerror=alert(1)>",
    { title: "Nightly backup" });
  const b = await push("alerts", "Disk almost full javascript:alert(1) see [doc](javascript:alert(2))", {
    title: "Disk", extras: { "client::notification": { click: { url: "https://example.org/disk" } } },
  });
  await pollNow();
  await waitBadge("2");
  const shown = await ext("return Object.keys(await browser.notifications.getAll());");
  assert.ok(shown.includes(`gotify-${a.id}`) && shown.includes(`gotify-${b.id}`), `notifications: ${shown}`);
  // only an http(s) click URL from the message extras is kept for the notification click
  const targets = await ext("return browser.storage.session.get(null);");
  assert.deepEqual(targets, { [`gotify-${b.id}`]: "https://example.org/disk" });
});

test("polls by itself every <interval> minutes", { timeout: 150000 }, async () => {
  await push("alerts", "third message, picked up by the alarm");
  await waitBadge("3", 130000); // interval = 1 minute: no manual poll
});

test("the interval is configurable and re-arms the poll alarm", async () => {
  const period = await ext('return (await browser.alarms.get("poll")).periodInMinutes;');
  assert.equal(period, 1);
  await saveOptions({ url: GOTIFY, token: client, interval: 5 });
  await waitFor("alarm re-armed at 5 minutes",
    async () => (await ext('return (await browser.alarms.get("poll")).periodInMinutes;')) === 5);
  // stays at 5: no later test relies on the alarm, and a stray alarm poll would split
  // the burst of the summary-notification test
});

test("popup: unread messages since the last opening, safe text, clickable links", async () => {
  await openExt("popup.html");
  const items = await driver.wait(until.elementsLocated(By.css("#list li")), 15000);
  assert.equal(items.length, 4, "3 unread + the one sent before configuration");
  assert.equal((await driver.findElements(By.css("#list li.unread"))).length, 3);
  assert.equal(await driver.findElement(By.id("summary")).getText(), "3 unread");

  // message content is text: the HTML payload is displayed, never parsed
  assert.equal((await driver.findElements(By.css("#list .title *, #list .body :not(a)"))).length, 0);
  const body = await driver.findElement(By.xpath("//li[.//div[@class='title' and text()='Nightly backup']]//div[@class='body']"));
  assert.match(await body.getText(), /<b>bold<\/b><img src=x onerror=alert\(1\)>/);

  // only http(s) URLs become links, trailing punctuation excluded
  const links = await driver.findElements(By.css("#list a"));
  const hrefs = await Promise.all(links.map((l) => l.getAttribute("href")));
  assert.deepEqual(hrefs, ["https://example.org/report?id=1"]);
  assert.equal(await links[0].getText(), hrefs[0], "the link shows the URL it opens");
  assert.equal(await links[0].getAttribute("rel"), "noopener noreferrer");

  const popupTab = await driver.getWindowHandle();
  await links[0].click();
  await waitFor("link opened in a tab", async () => {
    for (const h of await driver.getAllWindowHandles()) {
      if (h === popupTab) continue;
      await driver.switchTo().window(h);
      if ((await driver.getCurrentUrl()).startsWith("https://example.org/report")) return true;
    }
    return false;
  });
});

test("opening the popup marks everything read", async () => {
  await driver.switchTo().window((await driver.getAllWindowHandles())[0]); // popup calls window.close()
  await openExt("options.html");
  await waitBadge("");
});

test("popup: filterable by application, reset at each opening", async () => {
  await push("backups", "backup two");
  await push("alerts", "alert two");
  await openExt("popup.html");
  await driver.wait(until.elementsLocated(By.css("#list li")), 15000);
  const select = await driver.findElement(By.id("app"));
  assert.ok(await select.isDisplayed(), "filter shown when several applications are listed");
  const labels = await Promise.all((await select.findElements(By.css("option"))).map((o) => o.getText()));
  assert.deepEqual(labels, ["All applications", "alerts (1)", "backups (1)"]);

  await select.findElement(By.css(`option[value="${apps.alerts.id}"]`)).click();
  const visible = async () => {
    const out = [];
    for (const li of await driver.findElements(By.css("#list li"))) {
      if (await li.isDisplayed()) out.push(await li.getAttribute("data-app"));
    }
    return out;
  };
  const shown = await visible();
  assert.ok(shown.length >= 1 && shown.every((id) => id === String(apps.alerts.id)), `visible apps: ${shown}`);

  // not remembered: opening the popup marks every application read, a kept filter
  // would hide the other applications' new messages
  await openExt("popup.html");
  await driver.wait(until.elementsLocated(By.css("#list li")), 15000);
  assert.equal(await driver.findElement(By.id("app")).getAttribute("value"), "");
  assert.ok(new Set(await visible()).size > 1, "every application visible again");
});

test("more than 3 new messages at once: one summary notification", async () => {
  await openExt("options.html");
  await waitBadge("");
  for (let i = 1; i <= 4; i++) await push("backups", `burst ${i}`);
  await pollNow();
  await waitBadge("4");
  const shown = await ext("return Object.keys(await browser.notifications.getAll());");
  assert.ok(shown.includes("gotify-summary"), `notifications: ${shown}`);
});

test("popup: delete one message, every message of an application, or all of them", async () => {
  const onServer = async (path = "/message") => (await gotify("GET", `${path}?limit=100`, { auth: client })).messages;
  await openExt("popup.html");
  await driver.wait(until.elementsLocated(By.css("#list li")), 15000);

  const first = await driver.findElement(By.css("#list li"));
  const id = Number(await first.getAttribute("data-id"));
  await first.findElement(By.css("button.delete")).click();
  await waitFor("message deleted on the server", async () => !(await onServer()).some((m) => m.id === id));
  await waitFor("message removed from the list",
    async () => (await driver.findElements(By.css(`#list li[data-id="${id}"]`))).length === 0);

  // "Delete all" follows the filter, and asks first: Cancel deletes nothing
  await driver.findElement(By.id("app")).findElement(By.css(`option[value="${apps.alerts.id}"]`)).click();
  await driver.findElement(By.id("clear")).click();
  assert.match(await driver.findElement(By.id("confirm-text")).getText(), /every message of alerts on the server/);
  await driver.findElement(By.id("confirm-no")).click();
  assert.ok(!(await driver.findElement(By.id("confirm")).isDisplayed()));
  assert.ok((await onServer(`/application/${apps.alerts.id}/message`)).length > 0, "Cancel kept the messages");
  await driver.findElement(By.id("clear")).click();
  await driver.findElement(By.id("confirm-yes")).click();
  await waitFor("alerts emptied on the server",
    async () => (await onServer(`/application/${apps.alerts.id}/message`)).length === 0);
  assert.ok((await onServer(`/application/${apps.backups.id}/message`)).length > 0, "other applications kept");
  await waitFor("alerts removed from the list",
    async () => (await driver.findElements(By.css(`#list li[data-app="${apps.alerts.id}"]`))).length === 0);

  await driver.findElement(By.id("clear")).click();
  assert.match(await driver.findElement(By.id("confirm-text")).getText(), /^Delete every message on the server\?$/);
  await driver.findElement(By.id("confirm-yes")).click();
  await waitFor("server emptied", async () => (await onServer()).length === 0);
  await waitFor("list emptied", async () => (await driver.findElements(By.css("#list li"))).length === 0);
  assert.equal(await driver.findElement(By.id("status")).getText(), "No message to show.");
  await waitBadge("");

  // the server is empty, the next message still counts as unread
  await push("backups", "after deleting everything");
  await pollNow();
  await waitBadge("1");
});

test("images: application icons, and the picture attached to a message", async () => {
  // Gotify's icon for an application without one, on the (plain http) server: handed over
  // as a data: URL, Firefox would upgrade an http image to https
  const icon = await fetch(`${GOTIFY}/static/defaultapp.png`)
    .then(async (r) => `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`);
  // a picture on another host, like a Radarr poster: loaded directly (works over https,
  // which this test server lacks: only the URL handed over is checked)
  const poster = "http://images/static/defaultapp.png";
  const plain = await push("backups", "no picture");
  const radarr = await push("alerts", "Movie downloaded", {
    title: "Radarr", extras: { "client::notification": { bigImageUrl: poster } },
  });
  await pollNow();
  const shown = await waitFor("notifications", async () => {
    const all = await ext("return browser.notifications.getAll();");
    return all[`gotify-${plain.id}`] && all[`gotify-${radarr.id}`] && all;
  });
  assert.equal(shown[`gotify-${plain.id}`].iconUrl, icon, "the application icon");
  assert.equal(shown[`gotify-${radarr.id}`].iconUrl, poster, "the attached picture first");

  await openExt("popup.html");
  await driver.wait(until.elementsLocated(By.css("#list li")), 15000);
  const loaded = (img) => driver.executeScript("return arguments[0].complete && arguments[0].naturalWidth > 0;", img);
  const icons = await driver.findElements(By.css("#list li .app-icon"));
  assert.equal(icons.length, (await driver.findElements(By.css("#list li"))).length, "one icon per message");
  await waitFor("application icon loaded (CSP allows it)", () => loaded(icons[0]));
  assert.equal(await icons[0].getAttribute("src"), icon);
  const pictures = await driver.findElements(By.css("#list li .picture"));
  assert.equal(pictures.length, 1, "only the message with a picture has one");
  await waitFor("picture URL set", async () => (await pictures[0].getAttribute("src")) === poster);
});
