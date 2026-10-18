/*! 

Copyright (C) 2025  HighLite

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

*/

import { ContextMenuManager } from './managers/game/contextMenuManager';
import { HookManager } from './managers/highlite/hookManager';
import { NotificationManager } from './managers/highlite/notificationManager';
import { PanelManager } from './managers/highlite/panelManager';
import { PluginManager } from './managers/highlite/pluginManager';
import { PluginDataManager } from "./managers/highlite/pluginDataManager";
import { UIManager } from './managers/highlite/uiManager';
import { SettingsManager } from './managers/highlite/settingsManager';
import { DatabaseManager } from './managers/highlite/databaseManager';
import { SoundManager } from './managers/highlite/soundsManager';
import { Reflector } from './reflector/reflector';

export class Highlite {
    hookManager: HookManager;
    contextMenuManager: ContextMenuManager;
    notificationManager: NotificationManager;
    pluginManager: PluginManager;
    uiManager: UIManager;
    panelManager: PanelManager;
    settingsManager: SettingsManager;
    databaseManager: DatabaseManager;
    soundManager: SoundManager;
    pluginDataManager: PluginDataManager;
    private boundLifecycleHooks = new Set<string>();

    constructor() {
        console.info('[CamelKit] Core Initializing!');

        document.highlite = {
            managers: {},
            gameHooks: {},
            gameLookups: {
                InventoryActions: { 0: 'use', 1: 'inspect', 2: 'drop', use: 0, inspect: 1, drop: 2 },
                GameWorldActions: { 0: 'attack', 1: 'talk_to', attack: 0, talk_to: 1 },
                Skills: ['weaponry', 'strength', 'defence', 'goodmagic', 'evilmagic', 'archery', 'hitpoints', 'woodcutting', 'fishing', 'cooking', 'mining', 'smithing'],
                SkillsMap: { weaponry: 0, strength: 1, defence: 2, goodmagic: 3, evilmagic: 4, archery: 5, hitpoints: 6, woodcutting: 7, fishing: 8, cooking: 9, mining: 10, smithing: 11 },
                EntityTypes: { 0: 'Environment', 1: 'Item', 2: 'Player', 3: 'NPC' },
                PlayerActions: { 0: 'IdleState', 1: 'MovingState' },
                GameInterfaces: { 0: 'Inventory', 1: 'Bank', 2: 'Shop' },
                SpellTypes: { 0: 'combat', 1: 'status', 2: 'inventory', 3: 'teleport' }
            }
        };

        this.pluginManager = new PluginManager();
        this.hookManager = new HookManager();

        this.contextMenuManager = new ContextMenuManager();
        this.notificationManager = new NotificationManager();

        this.uiManager = new UIManager();
        this.panelManager = new PanelManager();
        this.soundManager = new SoundManager();
        this.settingsManager = new SettingsManager();
        this.databaseManager = new DatabaseManager();
        this.pluginDataManager = new PluginDataManager();

        // Register the core sidebar icons (Plugin Hub, Settings) at page load so the sidebar
        // is populated on the main menu / logged out, and these sit before plugin icons.
        // Their content is still built later (Hub in start(), Settings on login). Guarded so
        // the login-time init reuses these instead of re-registering.
        try {
            this.pluginManager.ensureHubIcon();
            this.settingsManager.ensureSettingsIcon();
        } catch (e) { console.warn('[CamelKit] early sidebar icon registration failed', e); }
    }


    // NOTE: The login screen buttons attempt to open up in the camelkit window without these.
    async loginHooks(fnName: string, ...args: any[]) {
        if (fnName === 'LoginScreen_handleRegisterButtonClicked') {
            window.open('https://memoriesofmagic.com/register', '_blank');
        }
        if (fnName === 'LoginScreen_handleHomeButtonClicked') {
            window.open('https://memoriesofmagic.com/', '_blank');
        }
    }

    // NOTE: This is used to delay plugin-starting until after the login is complete.
    // This is because we want to associate user-settings with the user account.
    async startHook(fnName: string, ...args: any[]) {
        if (this.pluginManager.isLoggedIn) return;
        this.pluginManager.setLoginState(true);

        try {
            await this.settingsManager.init();
            await this.settingsManager.registerPlugins();
            await this.pluginDataManager.initialize();
            for (const plugin of this.pluginManager.plugins) {
                if (plugin.instance) {
                    try {
                        await this.pluginDataManager.addPlugin(plugin.instance);
                    } catch (e) {
                        console.warn(`[Highlite] Failed to bind data for plugin ${plugin.instance.pluginName}:`, e);
                    }
                }
            }
            this.pluginManager.initAll();
            this.pluginManager.postInitAll();
            this.pluginManager.startAll();
        } catch (e) {
            console.error('[Highlite] Error in startHook:', e);
        }
    }

    async stopHook(fnName: string, ...args: any[]) {
        if (!this.pluginManager.isLoggedIn) return;
        console.warn(`[CamelKit] Stopping all plugins due to: ${fnName}`);
        this.panelManager.forceClose();
        this.settingsManager.deinit();
        this.pluginManager.stopAll();
        this.pluginManager.setLoginState(false);
    }

    private registerLifecycleHook(targetClass: string, fnName: string, hookFn: (...args: any[]) => any) {
        const key = `${targetClass}_${fnName}`;
        if (this.boundLifecycleHooks.has(key)) return;
        if (this.hookManager.registerClassHook(targetClass, fnName, hookFn)) {
            this.boundLifecycleHooks.add(key);
        }
    }

    bindLifecycleHooks() {
        // Start Plugins and Settings after Login
        this.registerLifecycleHook('SocketManager', 'markGameCryptoReady', this.startHook.bind(this));
        this.registerLifecycleHook('GameManager', 'resolveLoginReady', this.startHook.bind(this));

        // Stop Plugins and Settings during logout events
        this.registerLifecycleHook('GameManager', 'handleConnectionLost', this.stopHook.bind(this));
        this.registerLifecycleHook('SocketManager', 'closeQuietly', this.stopHook.bind(this));
        this.registerLifecycleHook('SocketManager', 'failGameSocket', this.stopHook.bind(this));
        this.registerLifecycleHook('SocketManager', 'onDisconnect', this.stopHook.bind(this));
    }

    initialize() {
        console.info("[CamelKit] Core Initializing")

        // Bind the classes from the hook manager (registerClass)
        // Read all the found signature binding 
        Reflector.bindClassHooks(this.hookManager);

        // Bind the enums to the hook manager (registerEnum)
        // These are the lookup tables
        Reflector.bindEnumHooks(this.hookManager);

        this.bindLifecycleHooks();
    }

    async start() {
        console.info('[CamelKit] Core Started!');
        await this.databaseManager.initDB();
        if (!this.databaseManager.database) {
            console.error('[CamelKit] Database not initialized!');
            return;
        } else {
            console.info('[CamelKit] Database initialized!');
        }
        await this.notificationManager.askNotificationPermission();
    // Initialize Plugin Hub now that DB is ready
    await this.pluginManager.initialize();
    }

    stop() {
        console.info('[CamelKit] Core Stopped!');
        this.pluginManager.stopAll();
    }

    reload() {
        console.info('[CamelKit] Core Reloading');
        this.stop();
        this.start();
    }
}
