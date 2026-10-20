import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

import { cpSync, mkdirSync, existsSync, readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));

function copyStaticIconsPlugin() {
  return {
    name: 'copy-static-icons',
    buildStart() {
      const src = resolve(__dirname, 'static/icons')
      const dest = resolve(__dirname, 'out/main/icons')
      if (existsSync(src)) {
        mkdirSync(dest, { recursive: true })
        cpSync(src, dest, { recursive: true })
      }
    }
  }
}

function stageCorePlugin() {
  return {
    name: 'stage-core',
    buildStart() {
      const coreDist = resolve(__dirname, '../core/dist/index.js');
      const staticDest = resolve(__dirname, 'static/core.js');
      if (existsSync(coreDist)) {
        mkdirSync(resolve(__dirname, 'static'), { recursive: true });
        cpSync(coreDist, staticDest);
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  return {
    main: {
      plugins: [externalizeDepsPlugin(), copyStaticIconsPlugin()],
      define: {
        __CAMELKIT_VERSION__: JSON.stringify(pkg.version),
        // Baked at build time. Only TRUE in the canonical CamelKit/Client CI build (set in
        // build.yml from github.repository). Fork/test builds get FALSE → the auto-updater stays
        // off so a build a dev is testing is never clobbered; canonical builds update from
        __CAMELKIT_CANONICAL__: JSON.stringify(process.env.CAMELKIT_CANONICAL === 'true' || process.env.EVILLITE_CANONICAL === 'true'),
        __EVILLITE_CANONICAL__: JSON.stringify(process.env.CAMELKIT_CANONICAL === 'true' || process.env.EVILLITE_CANONICAL === 'true'),
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      plugins: [stageCorePlugin()],
      define: {
        __CAMELKIT_VERSION__: JSON.stringify(pkg.version),
      },
      resolve: {
        alias: [
          { find: '@static', replacement: resolve(__dirname, 'static') },
          { find: /^@(?:camelkit|evillite|highlite|ryelite)\/core(?:\/.*)?$/, replacement: resolve(__dirname, '../core/dist/index.js') }
        ]
      },
      ...(isDev && {
        server: {
          hmr: {
            protocol: 'ws',
            host: 'localhost',
            port: 5173
          },
          fs: {
            allow: ['..']
          },
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
          }
          // No Vite proxy: EvilLite loads evilquest.net (game, /api, /oauth, WS) through the
          // main-process protocol/webRequest handler, not the dev server. The inherited
          // RyeLite/HighLite proxy pointed /api + /socket.io at highspell.com and only caused
          // proxy errors here, so it's removed.
        }
      }),
      publicDir: resolve(__dirname, "static"),
      root: resolve(__dirname, 'src/renderer'),
      build: {
        rollupOptions: {
          input: {
            client: resolve(__dirname, 'src/renderer/client.html'),
            update: resolve(__dirname, 'src/renderer/update.html'),
            console: resolve(__dirname, 'src/renderer/console.html'),
            settings: resolve(__dirname, 'src/renderer/settings.html'),
          }
        }
      }
    }
  };
})
