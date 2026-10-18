// Copy the plugin asset caches (e.g. the World Map's prebaked model icons) into the
// renderer build output so they ship inside the packaged app and the main-process
// PluginAssetCache can read them at runtime (app.isPackaged -> out/renderer/plugins-data).
//
// In dev the caches are read straight from the source tree; this is only needed for
// packaged builds. Runs after `electron-vite build`.

import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src', 'renderer', 'client', 'plugins', 'data');
const dest = resolve(here, '..', 'out', 'renderer', 'plugins-data');

if (existsSync(src)) {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    const files = readdirSync(dest).filter(f => f.endsWith('.json'));
    console.log(`[build] copied ${files.length} plugin cache file(s) -> ${dest}: ${files.join(', ')}`);
} else {
    console.log('[build] no plugin data dir to copy (src/renderer/client/plugins/data)');
}

// Also copy static icons into out/main/icons and out/renderer/icons for runtime access
const iconsSrc = resolve(here, '..', 'static', 'icons');
if (existsSync(iconsSrc)) {
    const mainIconsDest = resolve(here, '..', 'out', 'main', 'icons');
    const rendererIconsDest = resolve(here, '..', 'out', 'renderer', 'icons');
    mkdirSync(mainIconsDest, { recursive: true });
    cpSync(iconsSrc, mainIconsDest, { recursive: true });
    mkdirSync(rendererIconsDest, { recursive: true });
    cpSync(iconsSrc, rendererIconsDest, { recursive: true });
    console.log('[build] copied static icons -> out/main/icons and out/renderer/icons');
}

// Stage core.js from packages/core/dist/index.js so local import maps resolve without CDN
const coreSrc = resolve(here, '..', '..', 'core', 'dist', 'index.js');
if (existsSync(coreSrc)) {
    const staticCoreDest = resolve(here, '..', 'static', 'core.js');
    const outCoreDest = resolve(here, '..', 'out', 'renderer', 'core.js');
    mkdirSync(resolve(here, '..', 'static'), { recursive: true });
    cpSync(coreSrc, staticCoreDest);
    mkdirSync(resolve(here, '..', 'out', 'renderer'), { recursive: true });
    cpSync(coreSrc, outCoreDest);
    console.log('[build] staged core.js -> static/core.js and out/renderer/core.js');
}

