"use strict";

const $ = (id) => document.getElementById(id);

getConfig().then(({ url, token }) => { $("url").value = url; $("token").value = token; });

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const status = $("status");
  const url = $("url").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  let pattern;
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
    pattern = originPattern(url);
  } catch { status.textContent = "Invalid URL: http(s)://host[:port][/path]."; return; }

  // Must run first, inside the click handler: host access to this server only,
  // so no CORS setting is needed on the Gotify side.
  if (!(await browser.permissions.request({ origins: [pattern] }))) {
    status.textContent = "Access to the server was refused: the extension cannot reach it.";
    return;
  }
  const old = await getConfig();
  await browser.storage.local.set({ url, token });
  if (old.url !== url) {
    await browser.storage.local.remove(["lastReadId", "lastNotifiedId"]);
    if (old.url && originPattern(old.url) !== pattern)
      browser.permissions.remove({ origins: [originPattern(old.url)] });
  }
  const plain = url.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)\b/.test(url);

  try {
    const user = await api({ url, token }, "/current/user");
    status.textContent = `Connected as ${user.name}.` +
      (plain ? " Warning: plain http — the token travels unencrypted." : "");
  } catch (e) {
    status.textContent = `Saved, but the test failed: ${e.message}`;
  }
  browser.runtime.sendMessage({ type: "poll" });
});
