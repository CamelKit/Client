# Plugins Directory

This directory is monitored by CamelKit during build and runtime.

## Testing Custom Plugins

You can place your custom or experimental plugin files (`.ts` or `.js`) directly into this directory for local development and testing.

CamelKit dynamically loads and registers any plugin module placed here:
- Export your plugin class as the default export (e.g. `export default class MyPlugin extends Plugin`).
- Each class extending `Plugin` from `@camelkit/core` will automatically be registered upon client start when plugins are enabled in settings.

> **Note:** Official and published plugins will be distributed via the Plugin Hub. This directory is reserved for local plugin development and testing.
