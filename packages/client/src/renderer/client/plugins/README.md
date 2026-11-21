# Plugins Directory

This directory is monitored by CamelKit during build and runtime (`import.meta.glob('./plugins/*.{js,ts}')`).

## Official Built-in Plugins (Monorepo Sync)

Official built-in plugins (such as `LootTrackerPlugin.js`) are developed as multi-file TypeScript packages in the [`CamelKit/Plugins`](https://github.com/CamelKit/Plugins) monorepo and synced into this directory as pre-compiled ESM bundles (`pnpm sync` in `Plugins` or `pnpm --filter @camelkit/client run sync:plugins`).

## Testing Custom Local Plugins

You can also place custom or experimental plugin files (`.ts` or `.js`) directly into this directory for local development and testing:
- Export your plugin class as the default export (e.g. `export default class MyPlugin extends Plugin`).
- Each class extending `Plugin` from `@camelkit/core` will automatically be registered upon client start when plugins are enabled in settings.
