<p><img src="https://github.com/user-attachments/assets/da5bb809-3949-4854-99e4-1619022444e7" width="128"/></p>
<p>
  <a href="https://discord.gg/highspell"><img alt="JoinDiscord" src="https://img.shields.io/badge/Discord-Join_Us-purple?style=flat&logo=Discord&label=Discord"/></a>
  <img alt="GitHub License" src="https://img.shields.io/github/license/Highl1te/HighliteDesktop">
  <img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/Highl1te/HighliteDesktop/main.yml">
  <img alt="Downloads" src="https://img.shields.io/github/downloads/Highl1te/HighliteDesktop/latest/total?label=Downloads&color=blue">
</p>

# CamelKit

CamelKit is an open-source game client for High Spell, forked from HighLite.

# Installing CamelKit
CamelKit is packaged as an Electron application and provides [Linux](#Linux), [MacOS](#MacOS), and [Windows](#Windows) support.

## Windows
1. Obtain the .exe file from the releases page
> [!WARNING]
> In Microsoft Edge, you may receive a download warning due to CamelKit not being commonly downloaded.
>
> You can typically resolve this by clicking '...' and selecting 'Keep'


> [!WARNING]
> CamelKit is currently un-signed due to the inherent cost of obtaining signing certificates for software. This results in install and download warnings.
> If we receive enough players (or complaints!) we will invest in obtaining certificates.
>
> You can resolve this by clicking 'More Info' and pressing 'Run anyway'

3. Install CamelKit
4. You will be prompted by the game client when launching to automatically install any future updates!
## Linux
1. Obtain the .AppImage file from the releases page
2. Execute the AppImage
3. You will be prompted by the game client when launching to automatically install any future updates!
## MacOS
> [!CAUTION]
> MacOS builds go largely untested so they may be more prone to buggy behavior.

1. Instructions Pending

# Related Repositories
The CamelKit ecosystem is distributed across multiple repositories, each serving a specific purpose in the overall architecture.

### Desktop Application
This repository! The desktop application handles:
- Electron-based desktop application mechanics
- Window management and user interface
- Core and plugin loading system
- Auto-updater functionality
- Cross-platform builds (Windows, Linux, macOS)

### Core
The core repository provides the API for interacting with the High Spell game code:
- **@camelkit/core** - TypeScript type definitions and hook managers for plugin development. (Maintains backwards compatibility for `@evillite/core` and `@ryelite/core`).
Supports:
- Game state monitoring and interaction APIs
- High Spell game client integration layer
- Plugin development framework and utilities
- Shared interfaces for game data access

### Plugin Hub
The Plugin Hub serves as the central registry:
- Verified plugin configurations
- Plugin version management

# Development
## Prerequisites
- **Node.js v22 LTS** - [Download here](https://nodejs.org/en/download)
- **pnpm** or **Yarn v4**

## Getting Started
1. **Clone the repository**
   ```bash
   git clone git@github.com:CamelKit/Client.git
   cd Client
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```
## Development Commands
### Development Mode
```bash
pnpm --filter @camelkit/client dev          # Start development server with hot reload
pnpm --filter @camelkit/client start        # Preview built application without packaging
```

### Building
```bash
pnpm --filter @camelkit/client build        # Build the application for production
```

### Test the built client (local)
```bash
pnpm --filter @camelkit/client try          # Build the packaged app (unpacked) and launch it
```

### Code Quality
```bash
yarn format       # Format code with Prettier
yarn format:check # Check code formatting
yarn format:fix   # Fix formatting issues
```

## Project Structure
- **`src/main/`** - Electron Main Process (Node Client Rendering)
- **`src/preload/`** - Preload Scripts (Middle-man APIs between Node Client and Web Page)
- **`src/renderer/`** - Renderer process (Web Page Rendering)
- **`scripts/`** - Build and development scripts
- **`build/`** - Application icons and build assets
