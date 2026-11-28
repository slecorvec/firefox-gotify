// Property-based tests (fast-check) of src/gotify.js, the code that turns untrusted
// server data (message text, extras, application records) into links, URLs and
// requests. Thousands of generated inputs per property, in Node, no browser needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import fc from "fast-check";

// gotify.js is a classic browser script: run it in a context with the few DOM calls
// linkify() makes. Its top-level functions become properties of the context.
class FakeElement {
  constructor(tag) { this.tag = tag; this.children = []; this.text = ""; }
  set textContent(v) { this.text = String(v); }
  append(...nodes) { for (const n of nodes) this.children.push(typeof n === "string" ? { text: n } : n); }
  addEventListener() {}
}
const gotify = vm.createContext({
  URL,
  document: {
    createDocumentFragment: () => new FakeElement("#fragment"),
    createElement: (tag) => new FakeElement(tag),
  },
});
vm.runInContext(fs.readFileSync(path.resolve(import.meta.dirname, "../../src/gotify.js"), "utf8"), gotify);
const { safeHttpUrl, linkify, trimUrl, appImageUrl, bigImageUrl } = gotify;

const isHttp = (u) => typeof u === "string" && /^https?:$/.test(new URL(u).protocol);
const anyText = fc.string({ unit: "binary", maxLength: 300 });
// text that likely holds URLs, among them hostile ones
const urlish = fc.array(fc.oneof(
  anyText,
  fc.webUrl({ withQueryParameters: true, withFragments: true }),
  // eslint-disable-next-line no-script-url -- hostile input under test, never run
  fc.constantFrom("javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd",
    "HTTP://Example.ORG/A", "https://xn--e1afmkfd.xn--p1ai/", "https://a.org/Foo_(bar))",
    "(see https://a.org/x).", "https://", "http://[::1]:80/", "https://a.org/<script>"),
), { maxLength: 6 }).map((parts) => parts.join(" "));

test("safeHttpUrl: null or an http(s) URL, never throws", () => {
  fc.assert(fc.property(fc.oneof(anyText, urlish, fc.webUrl()), (raw) => {
    const u = safeHttpUrl(raw);
    assert.ok(u === null || isHttp(u), `${raw} → ${u}`);
  }), { numRuns: 5000 });
});

test("safeHttpUrl: other schemes are refused whatever follows", () => {
  // eslint-disable-next-line no-script-url -- hostile input under test, never run
  const scheme = fc.constantFrom("javascript:", "data:", "file:", "blob:", "moz-extension:", "about:", "ftp:", "vbscript:");
  fc.assert(fc.property(scheme, anyText, (s, rest) => {
    assert.equal(safeHttpUrl(s + rest), null);
  }), { numRuns: 3000 });
});

test("trimUrl: a prefix, idempotent, no trailing sentence punctuation", () => {
  fc.assert(fc.property(fc.oneof(anyText, fc.webUrl()), (raw) => {
    const t = trimUrl(raw);
    assert.ok(raw.startsWith(t));
    assert.equal(trimUrl(t), t);
    assert.ok(!/[.,;:!?]$/.test(t), t);
  }), { numRuns: 5000 });
});

// Flattens linkify's output: text pieces and links, in order.
const parts = (frag) => frag.children.map((n) => (n.tag ? { link: n.href, rel: n.rel, shown: n.text, kids: n.children.length } : { text: n.text }));

test("linkify: only text and http(s) links, never throws", () => {
  fc.assert(fc.property(fc.oneof(anyText, urlish), (text) => {
    for (const p of parts(linkify(text, () => {}))) {
      if ("text" in p) continue;
      assert.ok(isHttp(p.link) && safeHttpUrl(p.link) === p.link, p.link);
      assert.equal(p.shown, p.link, "a link shows the URL it opens");
      assert.equal(p.rel, "noopener noreferrer");
      assert.equal(p.kids, 0);
    }
  }), { numRuns: 3000 });
});

test("linkify: text without a URL comes back unchanged", () => {
  fc.assert(fc.property(anyText.filter((t) => !/https?:\/\//i.test(t)), (text) => {
    const out = parts(linkify(text, () => {}));
    assert.ok(out.every((p) => "text" in p));
    assert.equal(out.map((p) => p.text).join(""), text);
  }), { numRuns: 3000 });
});

test("linkify: a URL in a sentence becomes one link to that URL; the words around are kept", () => {
  const url = fc.webUrl({ withQueryParameters: true, withFragments: true })
    .filter((u) => !/["'`<>]/.test(u) && !/[.,;:!?)\]}]$/.test(u));
  fc.assert(fc.property(fc.string({ maxLength: 20 }).filter((s) => !/https?:/i.test(s)), url, (words, u) => {
    const text = `${words} ${u} end.`;
    const out = parts(linkify(text, () => {}));
    const links = out.filter((p) => "link" in p);
    assert.equal(links.length, 1, text);
    assert.equal(links[0].link, new URL(u).href);
    assert.equal(out[0].text, `${words} `);
    assert.equal(out.at(-1).text, " end.");
  }), { numRuns: 3000 });
});

test("image URLs from server data: null or http(s), never throw on any extras shape", () => {
  const cfg = { url: "https://gotify.example.org" };
  fc.assert(fc.property(fc.anything(), fc.anything(), (extras, image) => {
    const big = bigImageUrl({ extras });
    assert.ok(big === null || isHttp(big));
    const icon = appImageUrl(cfg, { image });
    assert.ok(icon === null || isHttp(icon));
    if (typeof image === "string" && icon) assert.ok(icon.startsWith("https://gotify.example.org/"), icon);
  }), { numRuns: 3000 });
  fc.assert(fc.property(fc.webUrl(), (u) => {
    assert.equal(bigImageUrl({ extras: { "client::notification": { bigImageUrl: u } } }), new URL(u).href);
  }));
});

test("messagesAfter: exactly the messages newer than the last read one, across pages", async () => {
  // A fake Gotify: ids newest first; ?since=<id> returns ids lower than <id>.
  const ids = fc.uniqueArray(fc.integer({ min: 1, max: 5000 }), { maxLength: 1200 }).map((a) => a.sort((x, y) => y - x));
  await fc.assert(fc.asyncProperty(ids, fc.integer({ min: 0, max: 5000 }), async (all, afterId) => {
    gotify.api = async (_cfg, q) => {
      const p = new URL(q, "http://x");
      const since = Number(p.searchParams.get("since") ?? Infinity);
      return { messages: all.filter((id) => id < since).slice(0, Number(p.searchParams.get("limit"))).map((id) => ({ id })) };
    };
    const { messages, complete } = await gotify.messagesAfter({}, afterId);
    const newer = all.filter((id) => id > afterId);
    if (newer.length <= 1000) {
      assert.ok(complete);
      assert.deepEqual(Array.from(messages, (m) => m.id), newer); // Array.from: the vm context has its own Array
    } else {
      assert.ok(!complete, "beyond 1000 the count is marked incomplete (999+)");
      assert.deepEqual(Array.from(messages, (m) => m.id), newer.slice(0, 1000));
    }
  }), { numRuns: 200 });
});
