# Contributing

Issues and pull requests are welcome.

- Keep the extension dependency-free and build-free: `src/` is what ships.
- Message content is untrusted: build the DOM with `textContent` and elements, never
  HTML strings (ESLint enforces it).
- A new feature comes with its line in the README "Features" list and its check in
  [`test/e2e/extension.test.mjs`](test/e2e/extension.test.mjs).
- Run the end-to-end test before opening a pull request (command in the README); CI
  runs it again with MegaLinter and gitleaks.
- Pull request title: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  (`feat: …`, `fix(popup): …`). Pull requests are squash-merged: the title becomes the
  commit, and the changelog entry for `feat` and `fix`.
