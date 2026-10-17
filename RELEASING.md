# Releasing & local builds

## Branches
- **`dev`** — active development / integration. All feature branches PR into here.
- **`main`** — stable. `dev → main` when we cut a stable release.

Work on a feature branch → PR into `dev`. Don't push straight to `dev`/`main`.

## Two release channels (already wired)
The client has a **Release Channel** setting (Beta / Stable) and the auto-updater respects it.
Which channel a build belongs to is decided automatically by the workflow (`.github/workflows/build.yml`):

| Trigger | GitHub Release | Channel | Audience | Version Example |
|---|---|---|---|---|
| **Push to `dev`** | **pre-release** | **Beta** | devs + testers | `v0.0.1-beta.42` (auto-stamped with CI run number) |
| **Push to `main`** | **full release** | **Stable** | players | `v0.0.1` |
| **Tag `vX.Y.Z`** (clean) | **full release** | **Stable** | players | `v0.0.1` |
| **Tag `vX.Y.Z-beta.N`** | **pre-release** | **Beta** | devs + testers | `v0.0.1-beta.1` |
| **Manual Action Run** | **pre-release** | **Beta/Test** | testing | `v0.0.1-beta.<run_id>` or `-test.<run_id>` |

- **Automatic Betas:** Any commit pushed or merged into `dev` automatically builds cross-platform packages and cuts a GitHub Pre-release. Testers on the Beta channel will automatically receive update prompts.
- **Automatic Stable:** Merging `dev → main` cuts an official full release for players on the Stable channel.
- **Bumping & Tagging Client Releases:**
   ```bash
   # Bump version in packages/client/package.json only (no commit/tag)
   pnpm bump:client minor
   pnpm bump:client patch

   # Bump, run anti-bot guard, commit, and create release tag vX.Y.Z
   pnpm release:client patch
   pnpm release:client minor
   pnpm release:client 0.1.0
   ```
- **Manual Tags:** You can also explicitly cut a release at any time by tagging:
   ```bash
   git tag -a v0.0.1 -m "CamelKit v0.0.1"
   git push origin v0.0.1
   ```

## Testing builds locally
CI won't trigger until a PR/tag, so use these for day-to-day testing:

| Command (`cd packages/client`) | What it does |
|---|---|
| `pnpm dev` | Run from source with HMR — the fast inner loop (not a packaged build). |
| `pnpm try` | **Build the packaged app (unpacked) and launch it** — fastest way to test the *built* client. |
| `pnpm dist` | Build a full installer for your OS (`.deb`/`.exe`/`.dmg`) into `dist/`, to test install. |

Notes:
- Each dev builds for their own OS (electron-builder targets the host platform).
- Linux unsigned builds run with `--no-sandbox` (handled automatically by `pnpm try`).

## Plugins
Plugins live in their own repositories and are installed dynamically via the Plugin Hub.
For local testing during development, place custom plugin files (`.ts`/`.js`) in `packages/client/src/renderer/client/plugins/`.

---

## Releasing `@camelkit/core` (NPM)

The `@camelkit/core` library provides the TypeScript SDK and plugin APIs used by all CamelKit plugins.

### Automated Release via Helper
Run the release helper script to bump the version, compile/validate, and create the git commit + tag:
```bash
# Bump patch (0.0.1 -> 0.0.2)
pnpm release:core patch

# Or minor / major / explicit
pnpm release:core minor
pnpm release:core 0.1.0
```

Then push the commit and tag to GitHub:
```bash
git push origin dev
git push origin core-v0.0.2
```

### What Happens in CI
Pushing a `core-v*` tag triggers `.github/workflows/publish-core.yml`:
1. Executes `scripts/guard-input-fabrication.mjs` (anti-bot security check).
2. Compiles `@camelkit/core` (ESM bundle + TypeScript `.d.ts` declaration maps).
3. Verifies version matching between tag and `packages/core/package.json`.
4. Publishes `@camelkit/core` to the public NPM registry using secret `NPM_TOKEN`.
5. Publishes a GitHub Release documenting the new core version.

