# CamelKit Client

An open-source, RuneLite-inspired desktop client for the game **EvilQuest** ([Memories of Magic](https://memoriesofmagic.com)).

---

## Table of Contents

- [Overview](#overview)
- [Monorepo Architecture](#monorepo-architecture)
- [Remote VM + Local Desktop Dev Workflow](#remote-vm--local-desktop-dev-workflow)
  - [Why This Setup?](#why-this-setup)
  - [Prerequisites](#prerequisites)
  - [Step 1: Start Dev Server on the Linux VM](#step-1-start-dev-server-on-the-linux-vm)
  - [Step 2: Launch Electron on your Windows Desktop](#step-2-launch-electron-on-your-windows-desktop)
- [Real-Time Logging & Remote Debugging](#real-time-logging--remote-debugging)
  - [Unified Shared Logging](#unified-shared-logging)
  - [Live Chrome DevTools Protocol (CDP)](#live-chrome-devtools-protocol-cdp)
- [Repository Scripts](#repository-scripts)
- [Releasing & Updating @camelkit/core](#releasing--updating-camelkitcore)
- [Troubleshooting & Gotchas](#troubleshooting--gotchas)

---

## Overview

CamelKit intercepts the web game client for EvilQuest, loads custom styling and titlebars, injects game hooks via the **Reflector** engine, and hosts an extensible plugin ecosystem (such as Collection Log, World Map, and custom UI overlays).

### Core Features

- **Automated Reflector Engine**: Scans incoming game scripts for class signatures and automatically maps obfuscated runtime classes (GameEngine, SocketManager, EntityManager, etc.).
- **Local Game Asset & Protocol Interceptor**: Custom `eq://` protocol handles network proxying, script injection, and CORS bypass.
- **Extensible Plugin Framework**: Lifecycle hooks (`init()`, `start()`, `stop()`), custom UI panels, settings management, and in-game notifications.
- **Modern Monorepo Stack**: Turborepo, pnpm workspaces (`nodeLinker: hoisted`), TypeScript, Electron 37, and Vite 7.

---

## Monorepo Architecture

```
Client/
├── packages/
│   ├── client/          # Electron desktop application (Main, Preload, and Renderer)
│   ├── core/            # @camelkit/core: Reflector, game hook manager, plugin base classes, APIs
│   └── mobile/          # Mobile client package
├── logs/                # Shared runtime log stream (logs/client.log)
├── pnpm-workspace.yaml  # Workspace config (nodeLinker: hoisted)
├── turbo.json           # Turborepo task pipeline
└── package.json         # Workspace root scripts
```

---

## Remote VM + Local Desktop Dev Workflow

### Why This Setup?

When developing inside a remote Linux VM over SSH (e.g., using Antigravity, VS Code Remote, or headless cloud instances):
1. **GPU Acceleration**: Most cloud/VM instances lack a physical GPU. Running Chromium/Electron directly on the VM forces software rendering (`SwiftShader`), causing single-digit framerates in WebGL/Babylon.js.
2. **Headless Limitations**: Remote SSH sessions do not have a native X11/Wayland display.
3. **No Dual-Repo Hassle**: You do **not** need to clone the repository to your Windows machine or deal with `git push`/`git pull` cycles between the VM and desktop.

Instead, the **Linux VM** compiles TypeScript and serves Vite with Hot Module Reloading (HMR), while your **Windows Desktop** runs the native Electron GPU window over a Samba (SMB) network drive.

```
┌───────────────────────────────────────────────┐         ┌──────────────────────────────────────────────┐
│                   Linux VM                    │  Samba  │               Windows Desktop                │
│                                               │  (SMB)  │                                              │
│  • Antigravity IDE / Code Editor              │ ◄─────► │  • Mounted as W:\evilquest\camelcore\Client  │
│  • Vite HMR Dev Server (Port 5175)            │         │  • Local Electron executable (electron.exe) │
│  • Turbo build / Typechecking                 │   SSH   │  • Full Hardware GPU Acceleration (60+ FPS)  │
│  • Tail logs in real-time (logs/client.log)   │ ◄─────► │  • Streams console & errors to logs/         │
└───────────────────────────────────────────────┘ Tunnel  └──────────────────────────────────────────────┘
```

---

### Prerequisites

1. **Samba Share (VM -> Windows)**:
   - On the Linux VM, install and configure Samba (`/etc/samba/smb.conf`) to export the repository root.
   - On Windows, map the share to a drive letter (e.g., `W:\evilquest\camelcore\Client`).
2. **Node.js & Electron on Windows**:
   - Install Electron globally on your Windows machine:
     ```powershell
     npm install -g electron
     ```
3. **SSH Port Forwarding**:
   - Ensure port `5175` (Vite) is forwarded from the VM to your Windows desktop.
   - *(Optional)* For CDP debugging, reverse-forward port `9222` (`ssh -R 9222:localhost:9222`).

---

### Step 1: Start Dev Server on the Linux VM

In your terminal on the Linux VM (in Antigravity or SSH):

```bash
xvfb-run -a pnpm dev -- --noSandbox
```

- `xvfb-run -a`: Provides an in-memory virtual X display for headless environments.
- `--noSandbox`: Bypasses Ubuntu 24.04 AppArmor user namespace restrictions for the local runner.
- The Vite server will boot and serve the client at `http://localhost:5175/`.

---

### Step 2: Launch Electron on your Windows Desktop

In **PowerShell** on your Windows desktop:

```powershell
$env:EQ_DEBUG = "1"
$env:ELECTRON_RENDERER_URL = "http://localhost:5175"
electron W:\evilquest\camelcore\Client\packages\client
```

- Electron runs natively on your Windows GPU.
- Loads the live UI from `http://localhost:5175/client.html`.
- Any code edit saved on the Linux VM in Antigravity triggers instant Vite HMR directly inside your Windows window.

---

## Real-Time Logging & Remote Debugging

### Unified Shared Logging

All log output from the Windows Electron app is automatically redirected to the repository's shared log file:
```
logs/client.log
```

#### What gets logged:
- **Main Process**: App lifecycle, update checks, window states, IPC events, and OAuth logins.
- **Renderer Process**: All `console.log`, `console.warn`, and `console.error` calls from the game, Reflector, plugins, and network intercepts.
- **Process Errors**: Uncaught exceptions and unhandled promise rejections.

#### Watching logs on the Linux VM:
In your VM terminal, run:
```bash
pnpm logs
# or
tail -f logs/client.log
```
Because the Samba mount writes directly to disk, the VM receives log updates with zero latency.

---

### Live Chrome DevTools Protocol (CDP)

When launched with `$env:EQ_DEBUG = "1"`, Electron exposes Chrome DevTools Protocol on port `9222`.

To allow an AI assistant or debugging tools on the Linux VM to inspect and drive the client:
1. Connect via SSH with reverse port forwarding:
   ```bash
   ssh -R 9222:localhost:9222 user@vm-ip
   ```
2. Verify from the VM:
   ```bash
   curl http://localhost:9222/json
   ```
This provides programmatic access to inspect the game DOM, evaluate runtime variables (`document.client`, Reflector hooks), and capture screenshots.

---

## Repository Scripts

Run from the root of the repository:

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Starts Turborepo dev pipeline across all packages |
| `pnpm build` | Compiles `@camelkit/core` and builds `@camelkit/client` artifacts (`out/`) |
| `pnpm release:core` | Bumps version, runs guards, commits, and tags `@camelkit/core` release |
| `pnpm logs` | Tails `logs/client.log` in real time |
| `pnpm format` | Formats all code with Prettier |
| `pnpm format:check` | Verifies code formatting |
| `pnpm format:fix` | Fixes formatting issues across the monorepo |

### Packaging Desktop Releases

To build production distributables (run from `packages/client` or via workspace filters):

```bash
pnpm -F @camelkit/client build:win     # Builds Windows installer / executable
pnpm -F @camelkit/client build:linux   # Builds Linux AppImage
pnpm -F @camelkit/client build:mac     # Builds macOS universal DMG
pnpm -F @camelkit/client build:unpack  # Unpacked directory without installer
```

---

## Releasing & Updating @camelkit/core

The [`@camelkit/core`](https://www.npmjs.com/package/@camelkit/core) library provides the TypeScript SDK, class signatures, Reflector engine, and lifecycle managers consumed by all CamelKit plugins.

### 1. Bumping & Cutting a Core Release

From the root of the `Client` repository, run the release helper:

```bash
# Bump patch version (e.g. 0.0.1 -> 0.0.2)
pnpm release:core patch

# Bump minor version (e.g. 0.0.1 -> 0.1.0)
pnpm release:core minor

# Bump major version (e.g. 0.0.1 -> 1.0.0)
pnpm release:core major

# Or set an explicit custom version
pnpm release:core 0.0.2-beta.1
```

The script automatically:
1. Runs anti-bot input fabrication quality guards (`scripts/guard-input-fabrication.mjs`).
2. Builds declaration files and esbuild output (`pnpm --filter @camelkit/core build`).
3. Updates version in `packages/core/package.json`.
4. Creates a Git release commit and annotated tag (`core-v<version>`).

### 2. Publishing to NPM via GitHub Actions

Push the commit and tag to GitHub to trigger automated NPM publishing via [`.github/workflows/publish-core.yml`](.github/workflows/publish-core.yml):

```bash
# Push branch and the new core tag
git push origin dev
git push origin core-v0.0.2

# Or push dev and all tags in one command:
git push origin dev --tags
```

The CI workflow automatically:
- Runs quality guards and builds the package.
- Authenticates with NPM using **OIDC Trusted Publishing** (cryptographically signed, no 2FA prompts).
- Signs and publishes the package to public [NPM](https://www.npmjs.com/package/@camelkit/core) with Sigstore provenance.
- Generates a GitHub Release with release notes.

### 3. Consuming Updates in Plugins

In plugin repositories (such as `Plugin-Vault` or plugins created from `Plugin-Example`):

```bash
# Using Yarn
yarn add -D @camelkit/core@latest

# Using npm
npm install --save-dev @camelkit/core@latest

# Using pnpm
pnpm add -D @camelkit/core@latest
```

*(Note: Plugins generated from `Plugin-Example` have Dependabot configured to automatically open weekly pull requests whenever a new `@camelkit/core` version is released).*

---

## Troubleshooting & Gotchas

### 1. `Cannot find module 'fs-extra'` / Symlink Traversal Over Samba
- **Cause**: By default, `pnpm` uses a symlinked virtual store (`node_modules/.pnpm`). Windows SMB network drives cannot resolve relative POSIX symlinks.
- **Fix**: The workspace uses `nodeLinker: hoisted` in `pnpm-workspace.yaml`. Dependencies are installed as standard flat directories in root `node_modules`. Do not revert to isolated linking.

### 2. `Main thread panicked ... absolute path with drive letter`
- **Cause**: The native Rust CLI engine in `pnpm v12` crashes when executed directly inside a Windows mapped network drive (e.g. `W:\`).
- **Fix**: Do not run `pnpm` on Windows inside `W:\`. Run all `pnpm` commands and compilation on the Linux VM; on Windows, only invoke `electron W:\...`.

### 3. `The SUID sandbox helper binary was found, but is not configured correctly`
- **Cause**: Ubuntu 24.04 (Noble Numbat) restricts unprivileged user namespaces (`kernel.apparmor_restrict_unprivileged_userns = 1`).
- **Fix**: Pass `--noSandbox` to `electron-vite dev`, or enable namespaces on the host:
  ```bash
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
  ```

### 4. `Missing X server or $DISPLAY`
- **Cause**: Running Electron in a headless SSH session without a GUI display.
- **Fix**: Wrap commands in `xvfb-run -a` on the Linux VM.
