// Copyright (C) 2025  HighLite

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { ipcMain, BrowserWindow, app, shell } from 'electron';
import log from 'electron-log';
import * as path from 'path';
import { settingsService } from '../../modules/settingsManagement';
import { getAppIconPath } from '../../icon';

// Baked at build time by electron.vite.config.ts (define). TRUE only in the canonical
// CamelKit/Client CI build; FALSE in fork/test builds so they never auto-update.
declare const __CAMELKIT_CANONICAL__: boolean;
declare const __EVILLITE_CANONICAL__: boolean;

async function configureAutoUpdater(autoUpdater: any) {
    autoUpdater.autoDownload = false; // Disable auto download to control it manually
    autoUpdater.logger = log;
    await settingsService.load();

    const releaseChannel = settingsService.getByName('Release Channel');
    if (releaseChannel === 'Beta') {
        log.info('[Updater] Using Beta channel for updates');
        autoUpdater.allowDowngrade = false;
        autoUpdater.allowPrerelease = true;
    } else {
        log.info('[Updater] Using Stable channel for updates');
        autoUpdater.allowDowngrade = true;
        autoUpdater.allowPrerelease = false;
    }

    return Promise.resolve();
}


export async function createUpdateWindow() {
    let autoUpdater: any = null;
    if (app.isPackaged) {
        try {
            const updaterModule: any = await import('electron-updater');
            autoUpdater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;
            if (autoUpdater) {
                await configureAutoUpdater(autoUpdater);
            } else {
                log.error('[Updater] autoUpdater instance not found on imported electron-updater module');
            }
        } catch (e) {
            log.error('[Updater] Failed to load electron-updater:', e);
        }
    }

    const updateWindow = new BrowserWindow({
        title: 'Updating CamelKit...',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            sandbox: false, // Disable sandboxing for compatibility with some libraries
        },
        frame: true,
        resizable: false,
        icon: getAppIconPath(),
        titleBarStyle: 'hidden',
        width: 600,
        height: 400,
    });

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        updateWindow.loadURL(
            `${process.env['ELECTRON_RENDERER_URL']}/update.html`
        );
    } else {
        updateWindow.loadFile(path.join(__dirname, '../renderer/update.html'));
    }

    // Proceed into the client exactly once. The update feed may be unconfigured,
    // offline, or empty — in any of those cases we must NOT leave the user stuck on
    // "Checking for updates…". Anything that means "we're not installing an update
    // right now" routes through here.
    let proceeded = false;
    let updateCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    const clearUpdateTimeout = () => {
        if (updateCheckTimeout) { clearTimeout(updateCheckTimeout); updateCheckTimeout = null; }
    };
    const proceedToClient = (reason: string) => {
        if (proceeded) return;
        proceeded = true;
        clearUpdateTimeout();
        log.info(`[Updater] proceeding to client: ${reason}`);
        ipcMain.emit('no-update-available');
    };

    updateWindow.on('ready-to-show', async () => {
        if (!app.isPackaged || !autoUpdater) {
            ipcMain.emit('delay-update');
        } else if (!(typeof __CAMELKIT_CANONICAL__ !== 'undefined' ? __CAMELKIT_CANONICAL__ : __EVILLITE_CANONICAL__)) {
            // Fork / test build: never auto-update. Devs grab these to try a change before its PR
            // is finished — they must NOT be pulled to a canonical release and lose the build under
            // test. Only canonical (CamelKit/Client) CI builds check the feed. See build.yml.
            proceedToClient('non-canonical (fork/test) build — auto-update disabled');
        } else {
            // Safety net: if the check neither resolves nor errors (e.g. the feed
            // host hangs), proceed anyway after a grace period.
            updateCheckTimeout = setTimeout(() => proceedToClient('update check timed out'), 15000);
            autoUpdater.checkForUpdates().catch(err => {
                log.error('[Updater] checkForUpdates rejected:', err);
                proceedToClient('update check failed');
            });
        }
    });

    if (autoUpdater) {
        autoUpdater.on('download-progress', progressObj => {
            log.info('Download progress:', progressObj.percent);
            updateWindow.webContents.send('download-progress', progressObj.percent);
        });

        autoUpdater.on('update-downloaded', async () => {
            log.info('Update downloaded');
            updateWindow.webContents.send('update-downloaded');
        });

        autoUpdater.on('update-available', async updateInfo => {
            log.info('Update available:', updateInfo.releaseName);
            // An update is pending the user's choice — don't auto-proceed on the timeout.
            clearUpdateTimeout();
            updateWindow.webContents.send('update-available', updateInfo);
        });

        autoUpdater.on('update-not-available', async () => {
            log.info('Update not available');
            proceedToClient('no update available');
        });

        // No feed configured / network failure / signature error — never hang.
        autoUpdater.on('error', err => {
            log.error('[Updater] error:', err);
            proceedToClient('update check error');
        });

        ipcMain.once('install-update', async () => {
            log.info('Installing update...');
            try {
                autoUpdater.quitAndInstall(true, true);
            } catch (err) {
                log.error('[Updater] quitAndInstall error:', err);
                proceedToClient('quitAndInstall failed');
            }
        });

        ipcMain.once('download-update', async () => {
            log.info('Downloading update...');
            try {
                await autoUpdater.downloadUpdate();
            } catch (err) {
                log.error('[Updater] downloadUpdate rejected:', err);
                proceedToClient('downloadUpdate rejected');
            }
        });
    }

    ipcMain.once('delay-update', async () => {
        log.info('Update delayed');
    });

    // Open Links in External Browser
    updateWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    return updateWindow;
}
