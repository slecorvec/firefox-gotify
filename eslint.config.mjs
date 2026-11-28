// ESLint flat config, self-contained (no plugin, no import): run by MegaLinter in CI.
const browserGlobals = Object.fromEntries([
  "browser", "document", "window", "location", "console", "fetch", "URL", "AbortSignal", "FileReader", "setTimeout", "clearTimeout",
].map((g) => [g, "readonly"]));
// src/gotify.js is a classic script shared by the other pages: its top-level names are globals there.
const shared = Object.fromEntries([
  "getConfig", "originPattern", "api", "allowDeletes", "messagesAfter", "latestId", "clampInterval", "safeHttpUrl", "appImageUrl", "bigImageUrl", "imageSrc", "linkify",
].map((g) => [g, "readonly"]));
const nodeGlobals = Object.fromEntries([
  "process", "Buffer", "console", "fetch", "setTimeout", "URL", "performance",
].map((g) => [g, "readonly"]));

const rules = {
  "no-undef": "error",
  "no-unused-vars": ["error", { vars: "local", caughtErrors: "none" }],
  "prefer-const": "error",
  eqeqeq: ["error", "smart"],
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
  // Message content is untrusted: it reaches the DOM as text nodes only.
  "no-restricted-properties": ["error",
    ...["innerHTML", "outerHTML"].map((property) => ({ property, message: "Use textContent / DOM nodes: message content is untrusted." })),
    ...["insertAdjacentHTML", "write", "writeln", "createContextualFragment", "parseFromString",
      "setHTMLUnsafe", "parseHTMLUnsafe", "srcdoc"].map((property) =>
      ({ property, message: "No HTML parsing of untrusted content." })),
  ],
};

export default [
  { ignores: ["node_modules/", "dist/", "megalinter-reports/"] },
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: { ...browserGlobals, ...shared } },
    rules,
  },
  {
    files: ["test/**/*.mjs", "*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: nodeGlobals },
    rules,
  },
];
