# Releasing

A release is the owner's action: the agent prepares the pull request, the owner merges
it, pushes the tag and approves the signing.

## Each release

1. A pull request sets the version in `src/manifest.json` and turns the
   `## X.Y.Z — unreleased` heading of `CHANGELOG.md` into `## X.Y.Z — YYYY-MM-DD`.
2. Merge it, then tag that commit on `master` and push the tag:

   ```sh
   git switch master && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. [`release.yml`](.github/workflows/release.yml) then:
   - checks that the tag equals the manifest version, runs `web-ext lint` and the
     property tests, builds `gotify-unread-X.Y.Z.zip` (the content of `src/`);
   - attests its build provenance (Sigstore, visible under the repository's
     *Attestations*);
   - publishes a GitHub release with the zip, its `.sha256` and the CHANGELOG section;
   - if the repository variable `AMO_SIGN` is `true`, waits for the owner's approval
     (environment `amo`), then submits the version to addons.mozilla.org (listed
     channel). Mozilla reviews and signs it; users get it as an update.

Anyone can check that a release zip was built by this workflow from this repository:

```sh
gh attestation verify gotify-unread-X.Y.Z.zip --repo slecorvec/firefox-gotify
```

A dry run (build only, no attestation, no release) is available from the Actions tab:
*Release → Run workflow*.

## One-time setup for addons.mozilla.org

1. **First version by hand.** Sign in at <https://addons.mozilla.org/developers/> and
   submit the add-on once through the web form ("On this site"), uploading the zip of
   the first GitHub release. The form asks for what the API cannot guess: categories,
   license (0BSD; choose a custom license if 0BSD is not offered), privacy policy (none:
   the extension collects no data), and a listing description saying it is
   **unofficial** and crediting the logo
   ([github.com/gotify/logo](https://github.com/gotify/logo), CC BY 4.0). The add-on ID
   `gotify-unread@slecorvec` is taken from the manifest.
2. **API credentials.** <https://addons.mozilla.org/developers/addon/api/key/> →
   generate a JWT issuer and secret.
3. **GitHub environment.** Settings → Environments → New environment `amo`:
   - *Required reviewers*: yourself; *Prevent self-review* off (you are the only
     maintainer); *Deployment branches and tags*: tags matching `v*.*.*`;
   - environment secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (the values from step 2).
4. **Turn the job on.** Settings → Secrets and variables → Actions → *Variables* →
   `AMO_SIGN` = `true`.
5. **Protect the tags** (recommended). Settings → Rules → New tag ruleset, target
   `v*`, restrict creations, updates and deletions to the repository admin: nobody else
   can trigger a release.

The AMO credentials never leave the `amo` environment: only the signing job sees them,
after your approval, and `web-ext` reads them from its environment, not from a command
line.
