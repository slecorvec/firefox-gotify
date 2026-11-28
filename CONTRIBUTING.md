# Contributing

Issues and pull requests are welcome. Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md); security issues are reported privately, as
described in [SECURITY.md](SECURITY.md).

- Keep the extension dependency-free and build-free: `src/` is what ships.
- Message content is untrusted: build the DOM with `textContent` and elements, never
  HTML strings (ESLint enforces it).
- A new feature comes with its line in the README "Features" list and its check in
  [`test/e2e/extension.test.mjs`](test/e2e/extension.test.mjs).
- Code that handles server data in `src/gotify.js` gets a property in
  [`test/unit/gotify.test.mjs`](test/unit/gotify.test.mjs) (`npm run test:unit`).
- Run the end-to-end test before opening a pull request (command in the README); CI
  runs it again with MegaLinter and gitleaks.
