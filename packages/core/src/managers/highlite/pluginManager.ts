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

import type { Plugin } from '../../interfaces/highlite/plugin/plugin.class';
import type { PluginConfig } from '../../interfaces/highlite/plugin/PluginConfig.interface';
import { PanelManager } from './panelManager';
import { DatabaseManager } from './databaseManager';
import { SettingsManager } from './settingsManager';
import { PluginDataManager } from './pluginDataManager';

// CamelKit Hub API endpoints
export const DEFAULT_HUB_API_URL = 'https://api.camelkit.dev';

export interface ManagedPlugin {
    config: PluginConfig | undefined;
    class: (new () => Plugin) | undefined;
    instance: Plugin | undefined;
    blob?: Blob | undefined;
    url?: string | undefined; // object URL for imported blob
    installedConfig?: PluginConfig | undefined; // stored config of installed version
}

export class PluginManager {
    private static instance: PluginManager;
    private panelManager: PanelManager = new PanelManager();
    private databaseManager: DatabaseManager = new DatabaseManager();
    private settingsManager: SettingsManager = new SettingsManager();
    private pluginDataManager: PluginDataManager = new PluginDataManager();
    private panelContent!: HTMLDivElement;
    private listContainer!: HTMLDivElement;
    private searchInput!: HTMLInputElement;
    private currentFilter: string = '';
    private didInitialSync = false;
    private managedPlugins: ManagedPlugin[] = [];
    public isLoggedIn: boolean = false;

    public get plugins(): ManagedPlugin[] {
        return this.managedPlugins;
    }


    public setLoginState(isLoggedIn: boolean) {
        this.isLoggedIn = isLoggedIn;
    };

    private hubIconReady = false;

    constructor() {
        if (PluginManager.instance) return PluginManager.instance;
        if (document.highlite.managers.PluginManager) {
            PluginManager.instance = document.highlite.managers.PluginManager;
            return document.highlite.managers.PluginManager;
        }
        PluginManager.instance = this;
        document.highlite.managers.PluginManager = this;
    }

    /** Register the Plugin Hub sidebar icon (and its empty content panel) at page load, so
     *  it's visible on the main menu / logged out and ordered before plugin icons. The hub
     *  content is still populated later in initialize(). Idempotent. */
    ensureHubIcon() {
        if (this.hubIconReady) return;
        this.panelContent = this.panelManager.requestMenuItem('🗃️', 'Plugin Hub')[1] as HTMLDivElement;
        this.hubIconReady = true;
    }

    async initialize() {
        this.ensureHubIcon();
        this.panelContent.style.display = 'flex';
        this.panelContent.style.flexDirection = 'column';
        this.panelContent.style.padding = '8px';
        this.panelContent.style.gap = '8px';
        this.panelContent.style.background = 'var(--theme-background)';
        this.panelContent.style.overflowY = 'auto';
        this.panelContent.style.overflowX = 'hidden';
        this.panelContent.style.width = '-webkit-fill-available';

        // Toolbar with search
        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.alignItems = 'center';
        toolbar.style.gap = '8px';
        toolbar.style.position = 'sticky';
        toolbar.style.top = '0';
        toolbar.style.background = 'var(--theme-background)';
        toolbar.style.zIndex = '1';
        toolbar.style.padding = '4px 0';

        const searchWrapper = document.createElement('div');
        searchWrapper.style.flex = '1';
        searchWrapper.style.width = '-webkit-fill-available';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search plugins by name…';
        this.searchInput.style.width = '100%';
        this.searchInput.style.padding = '8px 12px';
        this.searchInput.style.border = '1px solid var(--theme-border)';
        this.searchInput.style.borderRadius = '6px';
        this.searchInput.style.background = 'var(--theme-background-mute)';
        this.searchInput.style.color = 'var(--theme-text-primary)';
        this.searchInput.style.width = '-webkit-fill-available';
        this.searchInput.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        this.searchInput.style.fontSize = '14px';
        this.searchInput.addEventListener('input', () => {
            this.currentFilter = this.searchInput.value.trim().toLowerCase();
            // Re-render list only (avoid re-sync)
            this.populatePluginHub();
        });
        searchWrapper.appendChild(this.searchInput);
        toolbar.appendChild(searchWrapper);

        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = '↻';
        refreshBtn.title = 'Refresh Plugin Hub';
        this.styleSecondaryButton(refreshBtn);
        refreshBtn.style.padding = '8px 12px';
        refreshBtn.style.fontSize = '16px';
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            try {
                await this.refreshHub();
            } finally {
                refreshBtn.disabled = false;
            }
        });
        toolbar.appendChild(refreshBtn);

        // Container for plugin cards
        this.listContainer = document.createElement('div');
        this.listContainer.style.display = 'flex';
        this.listContainer.style.flexDirection = 'column';
        this.listContainer.style.gap = '8px';

        this.panelContent.appendChild(toolbar);
        this.panelContent.appendChild(this.listContainer);

        // 1. Unconditionally load already-installed plugins from IndexedDB (works 100% offline!)
        await this.loadInstalledPluginsFromStorage();

        // 2. Query the remote Plugin Hub manifest (if online) and enrich plugin entries
        try {
            const pluginConfigs = await this.obtainPluginConfigs();
            for (const pluginConfig of pluginConfigs) {
                const key = this.getPluginKey(pluginConfig);
                const managed = this.managedPlugins.find((mp) => mp.config && this.getPluginKey(mp.config) === key);
                if (!managed) {
                    const managedPlugin: ManagedPlugin = {
                        config: pluginConfig,
                        class: undefined,
                        instance: undefined,
                    };
                    this.managedPlugins.push(managedPlugin);
                } else {
                    managed.config = pluginConfig; // update with latest remote manifest
                }
            }
        } catch (e) {
            console.warn('[CamelKit] Failed to fetch plugin hub manifest (offline?):', e);
        }

        await this.populatePluginHub();
    }

    /**
     * Load previously installed plugins directly from IndexedDB without relying on Hub connectivity.
     */
    public async loadInstalledPluginsFromStorage(): Promise<void> {
        if (!this.databaseManager.database) {
            await this.databaseManager.initDB();
        }
        if (!this.databaseManager.database) return;

        try {
            const keys = await this.databaseManager.database.getAllKeys('plugins');
            console.info(`[CamelKit] Loading ${keys.length} installed plugin(s) from local storage...`);
            for (const key of keys) {
                const installedPlugin = await this.databaseManager.database.get('plugins', key);
                if (!installedPlugin || !installedPlugin.blob) continue;

                let managed = this.managedPlugins.find(
                    (mp) => (mp.config && this.getPluginKey(mp.config) === key) ||
                            (mp.installedConfig && this.getPluginKey(mp.installedConfig) === key)
                );
                if (managed?.instance) continue;

                const blob = installedPlugin.blob as Blob;
                const url = URL.createObjectURL(blob);
                try {
                    const pluginModule = await import(/* @vite-ignore */ url);
                    const pluginClass = pluginModule.default;
                    if (typeof pluginClass !== 'function') {
                        URL.revokeObjectURL(url);
                        continue;
                    }
                    if (!managed) {
                        managed = {
                            config: installedPlugin.config,
                            class: pluginClass,
                            instance: undefined,
                            blob,
                            url,
                            installedConfig: installedPlugin.config,
                        };
                        this.managedPlugins.push(managed);
                    } else {
                        managed.class = pluginClass;
                        managed.blob = blob;
                        managed.url = url;
                        managed.installedConfig = installedPlugin.config;
                    }
                    this.registerPlugin(pluginClass);
                } catch (err) {
                    console.error(`[CamelKit] Failed to import installed plugin (${key}):`, err);
                    URL.revokeObjectURL(url);
                }
            }
        } catch (e) {
            console.error('[CamelKit] Error loading installed plugins from IndexedDB:', e);
        }
    }

    public async getHubApiUrl(): Promise<string> {
        let configured: any;
        try {
            configured = await (window as any).settings?.getByName?.('Plugin Hub API URL');
        } catch {
            // ignore
        }
        if (typeof configured === 'string' && configured.trim().length > 0) {
            return configured.trim().replace(/\/$/, '');
        }
        const envUrl = (typeof process !== 'undefined' && process.env?.CAMELKIT_HUB_URL) ||
            ((import.meta as any)?.env?.VITE_HUB_URL);
        if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
            return envUrl.trim().replace(/\/$/, '');
        }
        return DEFAULT_HUB_API_URL;
    }

    public getPluginKey(config?: PluginConfig): string {
        if (!config) return '';
        return String(config.name ?? config.display_name ?? config.repository_name ?? (config.id !== undefined ? `plugin-${config.id}` : 'unknown'));
    }

    public getPluginTitle(config: PluginConfig): string {
        return config.name ?? config.display_name ?? config.repository_name ?? 'Unknown Plugin';
    }

    public getPluginAuthor(config: PluginConfig): string {
        return config.author ?? config.display_author ?? config.repository_owner ?? 'Unknown';
    }

    public getPluginDescription(config: PluginConfig): string {
        return config.description ?? config.display_description ?? 'No description provided.';
    }

    public getPluginVersion(config: PluginConfig): string {
        if (config.version) return config.version.startsWith('v') ? config.version : `v${config.version}`;
        if (config.latest_commit_hash) return `v${this.shortSha(config.latest_commit_hash)}`;
        if (config.asset_sha) return `v${this.shortSha(config.asset_sha)}`;
        return 'v1.0.0';
    }

    public isPluginUpToDate(installed?: PluginConfig, latest?: PluginConfig): boolean {
        if (!installed || !latest) return false;
        if (installed.asset_sha && latest.asset_sha) {
            return installed.asset_sha.toLowerCase() === latest.asset_sha.toLowerCase();
        }
        if (installed.latest_commit_hash && latest.latest_commit_hash) {
            return installed.latest_commit_hash.toLowerCase() === latest.latest_commit_hash.toLowerCase();
        }
        const instVer = (installed.version ?? '').toLowerCase();
        const latestVer = (latest.version ?? '').toLowerCase();
        return Boolean(instVer && latestVer && instVer === latestVer);
    }

    public getPluginGithubUrl(config: PluginConfig): string | null {
        if (config.github_url) return config.github_url;
        if (config.repository_owner && config.repository_name) {
            return `https://github.com/${config.repository_owner}/${config.repository_name}`;
        }
        return null;
    }

    public async refreshHub(): Promise<void> {
        const freshConfigs = await this.obtainPluginConfigs();
        for (const config of freshConfigs) {
            const key = this.getPluginKey(config);
            const existing = this.managedPlugins.find((p) => this.getPluginKey(p.config) === key);
            if (existing) {
                existing.config = config;
            } else {
                this.managedPlugins.push({
                    config,
                    class: undefined,
                    instance: undefined,
                });
            }
        }
        await this.populatePluginHub();
    }

    private async obtainPluginConfigs(): Promise<PluginConfig[]> {
        const pluginConfigs: PluginConfig[] = [];
        const baseUrl = await this.getHubApiUrl();
        const manifestUrl = `${baseUrl}/manifest.json`;

        try {
            console.log(`[CamelKit] Fetching plugin manifest from ${manifestUrl}...`);
            const res = await fetch(manifestUrl, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`Manifest request failed (${res.status})`);
            const manifest = await res.json();
            if (Array.isArray(manifest)) {
                for (const configuration of manifest) {
                    if (configuration && typeof configuration === 'object') {
                        pluginConfigs.push(configuration as PluginConfig);
                    }
                }
            } else if (manifest && typeof manifest === 'object' && Array.isArray((manifest as any).plugins)) {
                for (const configuration of (manifest as any).plugins) {
                    if (configuration && typeof configuration === 'object') {
                        pluginConfigs.push(configuration as PluginConfig);
                    }
                }
            }
            console.log(`[CamelKit] Retrieved ${pluginConfigs.length} plugin(s) from Plugin Hub.`);
        } catch (e) {
            console.warn(`[CamelKit] Failed to fetch plugin configs from ${manifestUrl}:`, e);
        }
        return pluginConfigs;
    }

    private async populatePluginHub() {
        // Clear only the list content; keep toolbar/search
        this.listContainer.innerHTML = '';

        // Filter to those with configs (renderable in hub)
        const withConfig = this.managedPlugins.filter((p) => p.config);
        if (withConfig.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.textContent = 'No plugins available from the Plugin Hub.';
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.color = 'var(--theme-text-muted)';
            emptyMessage.style.fontStyle = 'italic';
            emptyMessage.style.padding = '40px 20px';
            emptyMessage.style.background = 'var(--theme-background-soft)';
            emptyMessage.style.border = '1px solid var(--theme-border)';
            emptyMessage.style.borderRadius = '8px';
            emptyMessage.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            this.listContainer.appendChild(emptyMessage);
            return;
        }

        const filter = this.currentFilter;
        const filtered = withConfig.filter((p) => {
            const name = (p!.config!.name ?? p!.config!.display_name ?? p!.config!.repository_name ?? '').toLowerCase();
            const author = (p!.config!.author ?? p!.config!.display_author ?? p!.config!.repository_owner ?? '').toLowerCase();
            const description = (p!.config!.description ?? p!.config!.display_description ?? '').toLowerCase();
            return !filter || name.includes(filter) || author.includes(filter) || description.includes(filter);
        });

        // Default alphabetical sort (case-insensitive) by plugin display/repo name
        const sorted = filtered.sort((a, b) => {
            const an = this.getPluginTitle(a!.config!).toString();
            const bn = this.getPluginTitle(b!.config!).toString();
            return an.localeCompare(bn, undefined, { sensitivity: 'base' });
        });

        if (sorted.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.textContent = 'No matching plugins.';
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.color = 'var(--theme-text-muted)';
            emptyMessage.style.fontStyle = 'italic';
            emptyMessage.style.padding = '40px 20px';
            emptyMessage.style.background = 'var(--theme-background-soft)';
            emptyMessage.style.border = '1px solid var(--theme-border)';
            emptyMessage.style.borderRadius = '8px';
            emptyMessage.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            this.listContainer.appendChild(emptyMessage);
            return;
        }

        for (const plugin of sorted) {
            if (!plugin.config) continue;
            const config = plugin.config;
            const pluginKey = this.getPluginKey(config);

            const card = document.createElement('div');
            card.style.border = '1px solid var(--theme-border)';
            card.style.borderRadius = '8px';
            card.style.padding = '16px';
            card.style.marginBottom = '8px';
            card.style.background = 'var(--theme-background-mute)';
            card.style.color = 'var(--theme-text-primary)';
            card.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
            card.style.transition = 'all 0.2s ease';

            const title = document.createElement('h3');
            title.textContent = this.getPluginTitle(config);
            title.style.margin = '0 0 4px 0';
            title.style.fontSize = '16px';
            title.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            title.style.fontWeight = '600';
            title.style.color = 'var(--theme-text-primary)';

            const author = document.createElement('p');
            author.textContent = `By ${this.getPluginAuthor(config)}`;
            author.style.margin = '0 0 8px 0';
            author.style.fontStyle = 'italic';
            author.style.fontSize = '12px';
            author.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            author.style.fontWeight = '400';
            author.style.color = 'var(--theme-text-muted)';

            const description = document.createElement('p');
            description.textContent = this.getPluginDescription(config);
            description.style.margin = '0 0 12px 0';
            description.style.fontSize = '14px';
            description.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            description.style.fontWeight = '400';
            description.style.color = 'var(--theme-text-secondary)';

            // Version line
            const version = document.createElement('p');
            version.textContent = `Version: ${this.getPluginVersion(config)}`;
            version.style.margin = '0 0 12px 0';
            version.style.fontSize = '12px';
            version.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            version.style.fontWeight = '500';
            version.style.color = 'var(--theme-text-muted)';

            const installBtn = document.createElement('button');
            installBtn.textContent = 'Install';
            this.stylePrimaryButton(installBtn);
            // Disable if DB not ready yet
            if (!this.databaseManager.database) {
                installBtn.disabled = true;
                installBtn.title = 'Database not initialized yet';
            }

            const uninstallButton = document.createElement('button');
            uninstallButton.textContent = 'Uninstall';
            this.styleDangerButton(uninstallButton);

            const updateButton = document.createElement('button');
            updateButton.textContent = 'Update';
            this.styleSuccessButton(updateButton);
            updateButton.style.display = 'none';

            const githubButton = document.createElement('button');
            githubButton.textContent = 'View on GitHub';
            this.styleSecondaryButton(githubButton);
            const githubUrl = this.getPluginGithubUrl(config);
            if (githubUrl) {
                githubButton.onclick = () => {
                    window.open(githubUrl, '_blank');
                };
            }

            installBtn.onclick = async () => {
                installBtn.disabled = true;
                try {
                    if (!plugin.config) return;
                    const matchingAssetUrl = await this.downloadAndVerifyAsset(plugin.config);
                    if (!matchingAssetUrl) throw new Error(`Failed to load asset for ${this.getPluginTitle(plugin.config)}`);
                    const pluginModule = await import(/* @vite-ignore */ matchingAssetUrl);
                    const PluginClass = pluginModule.default;
                    if (typeof PluginClass !== 'function') throw new Error('Default export is not a valid plugin class');

                    // Associate the class to this managedPlugin before registering to avoid duplicates
                    plugin.class = PluginClass;
                    this.registerPlugin(PluginClass);

                    // Persist
                    await this.databaseManager.database?.put(
                        'plugins',
                        {
                            config: plugin.config,
                            blob: plugin.blob!,
                        },
                        pluginKey
                    );

                    uninstallButton.disabled = false;
                    // mark installed version in-memory
                    plugin.installedConfig = plugin.config;
                    if (actionsRow.contains(installBtn)) actionsRow.removeChild(installBtn);
                    // After install, no update button is needed (we just installed latest)
                    updateButton.style.display = 'none';
                    actionsRow.appendChild(uninstallButton);
                } catch (error) {
                    console.error(`[CamelKit] Failed to install plugin:`, error);
                    installBtn.textContent = 'Failed';
                    installBtn.classList.add('error');
                } finally {
                    installBtn.disabled = false;
                }
            };

            uninstallButton.onclick = async () => {
                try {
                    if (!plugin.config) return;
                    await this.databaseManager.database?.delete('plugins', pluginKey);
                    if (plugin.class) {
                        const installedPlugin = this.findPluginByClass(plugin.class);
                        if (installedPlugin) {
                            this.unregisterPlugin(installedPlugin);
                        }
                    }
                    if (plugin.url) {
                        URL.revokeObjectURL(plugin.url);
                        plugin.url = undefined;
                    }
                    plugin.blob = undefined;
                    plugin.installedConfig = undefined;
                    await this.settingsManager.refresh();
                    installBtn.disabled = false;
                    if (actionsRow.contains(uninstallButton)) actionsRow.removeChild(uninstallButton);
                    updateButton.style.display = 'none';
                    actionsRow.appendChild(installBtn);
                } catch (error) {
                    console.error(`[CamelKit] Failed to uninstall plugin:`, error);
                    uninstallButton.textContent = 'Failed';
                }
            };

            updateButton.onclick = async () => {
                updateButton.disabled = true;
                try {
                    if (!plugin.config) return;
                    const matchingAssetUrl = await this.downloadAndVerifyAsset(plugin.config);
                    if (!matchingAssetUrl) throw new Error(`Failed to load asset for ${this.getPluginTitle(plugin.config)}`);
                    const pluginModule = await import(/* @vite-ignore */ matchingAssetUrl);
                    const PluginClass = pluginModule.default;
                    if (typeof PluginClass !== 'function') throw new Error('Default export is not a valid plugin class');

                    // Stop/unregister current instance if present
                    if (plugin.instance) {
                        this.unregisterPlugin(plugin.instance);
                    }
                    plugin.class = PluginClass;
                    this.registerPlugin(PluginClass);
                    // Persist new version
                    await this.databaseManager.database?.put(
                        'plugins',
                        {
                            config: plugin.config,
                            blob: plugin.blob!,
                        },
                        pluginKey
                    );
                    // Update UI state
                    plugin.installedConfig = plugin.config;
                    version.textContent = `Version: ${this.getPluginVersion(plugin.config)}`;
                    updateButton.style.display = 'none';
                } catch (error) {
                    console.error(`[CamelKit] Failed to update plugin:`, error);
                    updateButton.textContent = 'Failed';
                } finally {
                    updateButton.disabled = false;
                }
            };

            card.appendChild(title);
            card.appendChild(author);
            card.appendChild(description);
            card.appendChild(version);
            const actionsRow = document.createElement('div');
            actionsRow.style.display = 'flex';
            actionsRow.style.gap = '8px';
            actionsRow.style.flexWrap = 'wrap';
            if (githubUrl) {
                actionsRow.appendChild(githubButton);
            }
            // On first render, sync with DB; afterwards rely on cached state
            const isInstalled = this.didInitialSync ? plugin.blob : await this.syncPluginState(plugin.config);
            if (isInstalled) {
                plugin.blob = isInstalled;
                // Show uninstall; and show update if installed version differs from latest
                actionsRow.appendChild(uninstallButton);
                const upToDate = this.isPluginUpToDate(plugin.installedConfig, plugin.config);
                updateButton.style.display = upToDate ? 'none' : 'inline-flex';
                if (!upToDate) actionsRow.appendChild(updateButton);
            } else {
                actionsRow.appendChild(installBtn);
            }
            card.appendChild(actionsRow);
            this.listContainer.appendChild(card);
        }
        this.didInitialSync = true;
    }

    private async syncPluginState(plugin: PluginConfig): Promise<Blob | undefined> {
        if (!this.databaseManager.database) return undefined; // DB guard
        const key = this.getPluginKey(plugin);
        const managed = this.managedPlugins.find((mp) => mp.config && this.getPluginKey(mp.config) === key);
        if (managed && managed.blob && managed.instance) {
            return managed.blob;
        }
        const installedPlugin = await this.databaseManager.database.get('plugins', key);
        if (installedPlugin) {
            const blob = installedPlugin.blob as Blob;
            const url = URL.createObjectURL(blob);
            try {
                const pluginModule = await import(url);
                const pluginClass = pluginModule.default;
                // Associate to managed plugin by key
                const managed = this.managedPlugins.find((mp) => this.getPluginKey(mp.config) === key);
                if (managed) {
                    managed.class = pluginClass;
                    managed.blob = blob;
                    managed.url = url;
                    managed.installedConfig = installedPlugin.config;
                }
                this.registerPlugin(pluginClass);
            } catch (e) {
                console.error('[CamelKit] Failed to load installed plugin', e);
                URL.revokeObjectURL(url);
                return undefined;
            }
            return blob;
        }
        return undefined;
    }

    private shortSha(sha: string, length: number = 8): string {
        const val = sha ?? '';
        const clean = val.includes(':') ? val.split(':').pop() as string : val;
        return clean.slice(0, Math.max(1, length));
    }

    private async downloadAndVerifyAsset(config: PluginConfig): Promise<string | null> {
        // If DB is not ready, fail fast
        if (!this.databaseManager.database) throw new Error('Database not initialized');

        let downloadUrl = config.download_url ?? config.url;
        if (!downloadUrl && config.repository_owner && (config.display_name ?? config.repository_name)) {
            const baseUrl = await this.getHubApiUrl();
            downloadUrl = `${baseUrl}/api/plugins/${config.repository_owner}/${config.display_name ?? config.repository_name}/`;
        }
        if (!downloadUrl) {
            throw new Error(`No download URL available for plugin: ${this.getPluginTitle(config)}`);
        }

        // If URL is relative, resolve against Hub API base URL
        if (downloadUrl.startsWith('/')) {
            const baseUrl = await this.getHubApiUrl();
            downloadUrl = `${baseUrl}${downloadUrl}`;
        }

        console.log(`[CamelKit] Downloading plugin from ${downloadUrl}...`);
        const resp = await fetch(downloadUrl, { cache: 'no-cache' });
        if (!resp.ok) throw new Error(`Plugin download failed (${resp.status}): ${downloadUrl}`);
        const buffer = await resp.arrayBuffer();
        if (config.asset_sha) {
            const hex = "sha256:" + await this.sha256Hex(buffer);
            const expected = (config.asset_sha ?? '').toLowerCase();
            if (hex !== expected) throw new Error(`[CamelKit] Asset sha mismatch for ${this.getPluginTitle(config)}. expected=${expected} actual=${hex}`);
        }
        const blob = new Blob([buffer], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const key = this.getPluginKey(config);
        const managed = this.managedPlugins.find((mp) => this.getPluginKey(mp.config) === key);
        if (managed) {
            managed.blob = blob;
            managed.url = url;
        }
        return url;
    }

    private async sha256Hex(buffer: ArrayBuffer): Promise<string> {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        const bytes = new Uint8Array(digest);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
        return hex;
    }

    private stylePrimaryButton(btn: HTMLButtonElement) {
        btn.style.padding = '8px 16px';
        btn.style.background = 'var(--theme-accent)';
        btn.style.color = 'var(--theme-text-dark)';
        btn.style.border = '1px solid var(--theme-accent-dark)';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        btn.style.fontWeight = '500';
        btn.style.transition = 'all 0.2s ease';
    }

    private styleDangerButton(btn: HTMLButtonElement) {
        btn.style.padding = '8px 16px';
        btn.style.background = 'var(--theme-danger)';
        btn.style.color = 'white';
        btn.style.border = '1px solid var(--theme-danger-dark)';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        btn.style.fontWeight = '500';
        btn.style.transition = 'all 0.2s ease';
    }

    private styleSecondaryButton(btn: HTMLButtonElement) {
        btn.style.padding = '8px 16px';
        btn.style.background = 'var(--theme-background-mute)';
        btn.style.color = 'var(--theme-text-primary)';
        btn.style.border = '1px solid var(--theme-border)';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        btn.style.fontWeight = '500';
        btn.style.transition = 'all 0.2s ease';
    }

    private styleSuccessButton(btn: HTMLButtonElement) {
        btn.style.padding = '8px 16px';
        btn.style.background = 'var(--theme-accent)';
        btn.style.color = 'var(--theme-text-dark)';
        btn.style.border = '1px solid var(--theme-accent-dark)';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        btn.style.fontWeight = '500';
        btn.style.transition = 'all 0.2s ease';
    }

    registerPlugin<T extends Plugin>(pluginClass: new () => T): boolean {
        const pluginInstance = new pluginClass();
        console.info(`[Highlite] New plugin ${pluginInstance.pluginName} registered`);
        // Find or create managed entry by class
        let managedPlugin = this.managedPlugins.find((mp) => mp.class === pluginClass);
        if (!managedPlugin) {
            managedPlugin = { config: undefined, class: pluginClass, instance: pluginInstance };
            this.managedPlugins.push(managedPlugin);
        } else {
            managedPlugin.class = pluginClass;
            managedPlugin.instance = pluginInstance;
        }


        // Check if we are logged in
        if (this.isLoggedIn) {
            (async () => {
                try {
                    if (this.settingsManager.isInitialized) {
                        await this.settingsManager.refresh();
                    }
                    const pdm = document.highlite?.managers?.PluginDataManager || this.pluginDataManager;
                    if (pdm && (pdm.isInitialized || pdm.initialized)) {
                        await pdm.addPlugin(pluginInstance);
                    }
                } catch (e) {
                    console.warn(`[Highlite] Failed to bind settings/data for ${pluginInstance.pluginName}:`, e);
                }

                if (pluginInstance.init) {
                    try { pluginInstance.init(); } catch (e) { console.error(`[Highlite] Error in init() for ${pluginInstance.pluginName}:`, e); }
                }

                if (pluginInstance.postInit) {
                    try { pluginInstance.postInit(); } catch (e) { console.error(`[Highlite] Error in postInit() for ${pluginInstance.pluginName}:`, e); }
                }

                const enabled = pluginInstance.settings?.enable?.value !== false;
                if (enabled && pluginInstance.start) {
                    try { pluginInstance.start(); } catch (e) { console.error(`[Highlite] Error in start() for ${pluginInstance.pluginName}:`, e); }
                }
            })();
        }

        return true;
    }

    initAll(): void {
        for (const plugin of this.plugins) {
            try {
                plugin.instance?.init();
            } catch (error) {
                console.error(`[Highlite] Error initializing plugin ${plugin.instance?.pluginName}:`, error);
            }
        }
    }

    postInitAll(): void {
        for (const plugin of this.plugins) {
            try {
                if (plugin.instance?.postInit) plugin.instance.postInit();
            } catch (error) {
                console.error(`[Highlite] Error post-initializing plugin ${plugin.instance?.pluginName}:`, error);
            }
        }
    }

    startAll(): void {
        for (const plugin of this.plugins) {
            if (plugin.instance?.settings.enable.value) {
                try {
                    plugin.instance?.start();
                } catch (error) {
                    console.error(`[Highlite] Error starting plugin ${plugin.instance?.pluginName}:`, error);
                }
            }
        }
    }

    stopAll(): void {
        for (const plugin of this.plugins) {
            if (plugin.instance?.settings.enable.value) {
                try {
                    plugin.instance?.stop();
                } catch (error) {
                    console.error(`[Highlite] Error stopping plugin ${plugin.instance?.pluginName}:`, error);
                }
            }
        }
    }

    findPluginByName(pluginName: string): Plugin | undefined {
        return this.plugins.find((managedPlugin) => managedPlugin.instance?.pluginName === pluginName)?.instance;
    }

    findPluginByClass(pluginClass: new () => Plugin): Plugin | undefined {
        return this.plugins.find((managedPlugin) => managedPlugin.class && managedPlugin.instance && managedPlugin.instance.constructor === pluginClass)?.instance;
    }

    unregisterPlugin(plugin: Plugin): boolean {
        try {
            if (plugin.settings.enable.value) {
                plugin.stop();
            }

            const index = this.managedPlugins.findIndex((mp) => mp.instance === plugin);
            if (index !== -1) {
                this.managedPlugins[index].instance = undefined;
                this.managedPlugins[index].class = undefined;
            }
            return true;
        } catch (error) {
            console.error(`[Highlite] Error unregistering plugin ${plugin.pluginName}:`, error);
            return false;
        }
    }
}
