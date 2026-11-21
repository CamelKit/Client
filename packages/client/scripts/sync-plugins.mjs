/**
 * Pulls and builds official built-in plugins from the CamelKit/Plugins monorepo
 * into `src/renderer/client/plugins/` so both Desktop and Mobile builds bundle them.
 *
 * Resolution order:
 *   1. $CAMELKIT_PLUGINS_DIR (explicit path to a local Plugins monorepo checkout)
 *   2. ../Plugins sibling of the Client repo root (standard local dev layout)
 *   3. If neither exists (e.g. offline/fork build), keeps existing tracked `.js` bundles in place.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const clientPkgRoot = resolve(here, '..');
const repoRoot = resolve(here, '..', '..', '..');

let pluginsRepo = process.env.CAMELKIT_PLUGINS_DIR
  ? resolve(process.env.CAMELKIT_PLUGINS_DIR)
  : resolve(repoRoot, '..', 'Plugins');

if (!existsSync(join(pluginsRepo, 'packages'))) {
  console.log(`[sync-plugins] Local Plugins monorepo not found at ${pluginsRepo}; using pre-staged plugin bundles.`);
  process.exit(0);
}

try {
  console.log(`[sync-plugins] Building official plugins in ${pluginsRepo}...`);
  execSync('pnpm build', { cwd: pluginsRepo, stdio: 'inherit' });
} catch (err) {
  console.warn('[sync-plugins] Warning: `pnpm build` in Plugins repo failed, syncing existing dist bundles if present:', err.message);
}

const packagesDir = join(pluginsRepo, 'packages');
const destPluginsDir = join(clientPkgRoot, 'src', 'renderer', 'client', 'plugins');
const destDataDir = join(destPluginsDir, 'data');

mkdirSync(destPluginsDir, { recursive: true });
mkdirSync(destDataDir, { recursive: true });

let count = 0;
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgDir = join(packagesDir, entry.name);
  const pkgJsonPath = join(pkgDir, 'package.json');
  const distBundle = join(pkgDir, 'dist', 'plugin.js');

  if (!existsSync(pkgJsonPath) || !existsSync(distBundle)) continue;

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const bundleName = pkgJson.camelkit?.bundleName || `${entry.name}.plugin.js`;
  cpSync(distBundle, join(destPluginsDir, bundleName));
  count++;

  const dataDir = join(pkgDir, 'data');
  if (existsSync(dataDir)) {
    for (const file of readdirSync(dataDir)) {
      if (file.endsWith('.json')) {
        cpSync(join(dataDir, file), join(destDataDir, file));
      }
    }
  }
}

console.log(`[sync-plugins] Synced ${count} official plugin bundle(s) from ${pluginsRepo}`);
