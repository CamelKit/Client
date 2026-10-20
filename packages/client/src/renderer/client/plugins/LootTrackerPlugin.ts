import { Plugin, SettingsTypes, PanelManager, abbreviateValue } from '@camelkit/core';

interface DropItem {
  itemId: number;
  name: string;
  quantity: number;
  value: number;
}

interface PendingKill {
  killId: string;
  entityId: number;
  npcDefId: number;
  npcName: string;
  combatLevel: number;
  deathTime: number;
  x: number;
  z: number;
  floor: number;
  drops: DropItem[];
  finalized: boolean;
}

interface EngagedTarget {
  entityId: number;
  defId: number;
  name: string;
  combatLevel: number;
  x: number;
  z: number;
  floor: number;
  lastEngaged: number;
}

interface MonsterDropSummary {
  itemId: number;
  name: string;
  quantity: number;
  totalValue: number;
}

interface MonsterSessionEntry {
  npcDefId: number;
  npcName: string;
  combatLevel: number;
  killCount: number;
  totalValue: number;
  drops: { [itemId: number]: MonsterDropSummary };
}

interface SessionData {
  startTime: number;
  totalKills: number;
  totalValue: number;
  monsters: { [key: string]: MonsterSessionEntry };
}

interface TelemetryEvent {
  npcDefId: number;
  npcName: string;
  combatLevel: number;
  drops: Array<{ itemId: number; itemName?: string; quantity: number }>;
  timestamp: number;
}

function dist(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

export default class LootTrackerPlugin extends Plugin {
  pluginName = 'Loot Tracker';
  author = 'CamelKit';

  private panelManager = new PanelManager();
  private menuIconElement: HTMLElement | null = null;
  private panelContainer: HTMLElement | null = null;

  // In-memory runtime state
  private engineTimer: ReturnType<typeof setInterval> | null = null;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  private engagedTargets = new Map<number, EngagedTarget>();
  private recentlyKilledEntities = new Set<number>();
  private killedEntityTimestamps = new Map<number, number>();
  private pendingKills: PendingKill[] = [];
  private seenGroundItemIds = new Set<number>();

  private telemetryQueue: TelemetryEvent[] = [];
  private syncStatus: 'synced' | 'pending' | 'offline' | 'opted_out' = 'pending';
  private lastSyncTime = 0;

  constructor() {
    super();

    this.settings.enable = {
      text: 'Enable Loot Tracker',
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.onToggleEnabled(),
    };

    this.settings.submitToWiki = {
      text: 'Contribute Anonymous Drops to Wiki',
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => {
        this.syncStatus = this.settings.submitToWiki.value ? 'pending' : 'opted_out';
        this.renderUI();
      },
    };

    this.settings.matchDistance = {
      text: 'Loot Matching Radius (Tiles)',
      type: SettingsTypes.range,
      value: 3,
      min: 1,
      max: 8,
      callback: () => {},
    };

    this.settings.dropWindowSeconds = {
      text: 'Loot Matching Window (Seconds)',
      type: SettingsTypes.range,
      value: 8,
      min: 3,
      max: 20,
      callback: () => {},
    };

    this.settings.telemetryEndpoint = {
      text: 'Wiki Telemetry URL',
      type: SettingsTypes.text,
      value: 'https://api.camelkit.dev/telemetry/drops',
      callback: () => {},
    };

    this.settings.resetSessionOnLogin = {
      text: 'Reset Session On Login',
      type: SettingsTypes.checkbox,
      value: false,
      callback: () => {},
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(): void {
    this.ensureData();
    if (this.settings.resetSessionOnLogin?.value) {
      this.resetSession();
    }
  }

  start(): void {
    this.info('start() called');
    this.ensureData();

    try {
      this.panelManager.removeMenuItem('📦');
    } catch {
      // ignore
    }

    try {
      const [iconEl, panelEl] = this.panelManager.requestMenuItem('📦', 'Loot Tracker');
      this.menuIconElement = iconEl;
      this.panelContainer = panelEl;
      if (this.menuIconElement) {
        this.menuIconElement.title = 'Loot Tracker';
      }
    } catch (e) {
      this.warn('Failed to register sidebar menu item:', e);
    }

    this.startEngine();
    this.renderUI();
    this.info('Loot Tracker started.');
  }

  stop(): void {
    this.stopEngine();

    if (this.telemetryQueue.length > 0 && this.settings.submitToWiki?.value) {
      void this.flushTelemetry();
    }

    try {
      this.panelManager.removeMenuItem('📦');
    } catch {
      // ignore
    }

    this.menuIconElement = null;
    this.panelContainer = null;
    this.info('Loot Tracker stopped.');
  }

  private onToggleEnabled(): void {
    if (this.settings.enable.value) {
      this.start();
    } else {
      this.stop();
    }
  }

  // ---------------------------------------------------------------------------
  // Game Accessors
  // ---------------------------------------------------------------------------

  private get gm(): any {
    return this.gameHooks?.GameManager?.Instance ?? (window as any).gm ?? null;
  }

  private get em(): any {
    return this.gameHooks?.EntityManager?.Instance ?? (window as any).em ?? this.gm?.entities ?? null;
  }

  private getPlayerPosition(): { x: number; z: number; floor: number } | null {
    const gm = this.gm;
    if (!gm) return null;
    return {
      x: gm.playerX ?? 0,
      z: gm.playerZ ?? 0,
      floor: gm.currentFloor ?? 0,
    };
  }

  private getNpcPosition(entityId: number): { x: number; z: number } | null {
    const em = this.em;
    if (!em) return null;

    const sprite = em.npcSprites?.get(entityId);
    if (sprite?.position) {
      return { x: sprite.position.x, z: sprite.position.z };
    }

    const target = em.npcTargets?.get(entityId);
    if (target && typeof target.x === 'number') {
      return { x: target.x, z: target.z };
    }

    return null;
  }

  private getItemDef(itemId: number): any {
    const em = this.em;
    return (
      (document as any).highlite?.gameHooks?.ItemDefinitionManager?._itemDefMap?.get(itemId) ??
      em?.itemDefsCache?.get(itemId) ??
      this.gm?.itemDefsCache?.get(itemId) ??
      null
    );
  }

  private getItemIconUrl(itemId: number): string {
    const origin =
      typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')
        ? window.location.origin
        : 'https://memoriesofmagic.com';

    const def = this.getItemDef(itemId);
    if (def?.icon) {
      return `${origin}/items/${def.icon}`;
    }
    return `${origin}/items/3d/${itemId}.png`;
  }

  private getItemFallbackIconUrl(itemId: number): string {
    const origin =
      typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')
        ? window.location.origin
        : 'https://memoriesofmagic.com';
    return `${origin}/items/3d/${itemId}.png`;
  }

  // ---------------------------------------------------------------------------
  // Data Persistence
  // ---------------------------------------------------------------------------

  private ensureData(): void {
    if (!this.data.session || typeof this.data.session !== 'object') {
      this.data.session = {
        startTime: Date.now(),
        totalKills: 0,
        totalValue: 0,
        monsters: {},
      };
    }
    if (!this.data.collapsed || typeof this.data.collapsed !== 'object') {
      this.data.collapsed = {};
    }
  }

  public resetSession(): void {
    this.data.session = {
      startTime: Date.now(),
      totalKills: 0,
      totalValue: 0,
      monsters: {},
    };
    this.pendingKills = [];
    this.renderUI();
  }

  // ---------------------------------------------------------------------------
  // Detection Engine
  // ---------------------------------------------------------------------------

  private startEngine(): void {
    this.stopEngine();
    this.engineTimer = setInterval(() => this.engineTick(), 120);
    this.telemetryTimer = setInterval(() => void this.flushTelemetry(), 45000);
  }

  private stopEngine(): void {
    if (this.engineTimer) {
      clearInterval(this.engineTimer);
      this.engineTimer = null;
    }
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
  }

  private engineTick(): void {
    const gm = this.gm;
    const em = this.em;
    if (!gm || !em) return;

    const now = Date.now();
    const playerPos = this.getPlayerPosition();

    // 1. Resolve active combat target (handles melee, ranged, and magic targeting)
    let targetId = -1;
    try {
      if (typeof gm.currentLocalNpcCombatTargetId === 'function') {
        targetId = gm.currentLocalNpcCombatTargetId() | 0;
      } else if (gm.magicTargetId >= 0) {
        targetId = gm.magicTargetId | 0;
      } else if (gm.combatTargetId >= 0) {
        targetId = gm.combatTargetId | 0;
      } else if (gm.localNpcCombatEngagementTargetId >= 0) {
        targetId = gm.localNpcCombatEngagementTargetId | 0;
      }
    } catch {
      // ignore
    }

    // 2. Track engaged monster
    if (targetId > 0) {
      const defId = em.npcDefs?.get(targetId) ?? -1;
      const def = em.npcDefsCache?.get(defId);
      const pos = this.getNpcPosition(targetId);
      const name = def?.name ?? `NPC #${defId > 0 ? defId : targetId}`;
      const combatLevel = def?.combatLevel ?? 0;
      const floor = gm.currentFloor ?? 0;

      this.engagedTargets.set(targetId, {
        entityId: targetId,
        defId,
        name,
        combatLevel,
        x: pos?.x ?? playerPos?.x ?? 0,
        z: pos?.z ?? playerPos?.z ?? 0,
        floor,
        lastEngaged: now,
      });
    }

    // Update positions of known engaged targets while they remain alive
    for (const [id, engaged] of this.engagedTargets) {
      if (em.npcDefs?.has(id) || em.npcSprites?.has(id)) {
        const pos = this.getNpcPosition(id);
        if (pos) {
          engaged.x = pos.x;
          engaged.z = pos.z;
        }
      }
    }

    // 3. Detect despawned/killed targets (Signal B)
    const maxKillDist = 12;
    for (const [id, engaged] of this.engagedTargets) {
      const isAlive = em.npcDefs?.has(id) || em.npcSprites?.has(id);
      if (!isAlive) {
        if (!this.recentlyKilledEntities.has(id)) {
          const timeSinceEngaged = now - engaged.lastEngaged;
          const distToPlayer = playerPos ? dist(engaged.x, engaged.z, playerPos.x, playerPos.z) : 0;
          if (timeSinceEngaged < 10000 && distToPlayer <= maxKillDist) {
            this.handleNpcKilled(engaged);
          }
        }
        this.engagedTargets.delete(id);
      }
    }

    // 4. Prune recently killed entity TTL
    for (const [id, deathTime] of this.killedEntityTimestamps) {
      if (now - deathTime > 15000) {
        this.killedEntityTimestamps.delete(id);
        this.recentlyKilledEntities.delete(id);
      }
    }

    // 5. Finalize pending kills whose drop window has elapsed
    const dropWindowMs = (Number(this.settings.dropWindowSeconds?.value) || 8) * 1000;
    for (let i = this.pendingKills.length - 1; i >= 0; i--) {
      const kill = this.pendingKills[i];
      if (now - kill.deathTime > dropWindowMs) {
        kill.finalized = true;
        this.enqueueTelemetry(kill);
        this.pendingKills.splice(i, 1);
      }
    }

    // 6. Backup polling for ground items in case hook missed anything
    this.pollGroundItems();
  }

  // ---------------------------------------------------------------------------
  // Hook Interceptors
  // ---------------------------------------------------------------------------

  /**
   * Hook: Intercepts when the game initiates NPC death sequence
   */
  EntityManager_startNpcDeathSequence(entityId: any, _sprite: any, _options: any): void {
    const id = entityId | 0;
    if (id <= 0) return;
    const engaged = this.engagedTargets.get(id);
    if (engaged && !this.recentlyKilledEntities.has(id)) {
      this.handleNpcKilled(engaged);
      this.engagedTargets.delete(id);
    }
  }

  /**
   * Hook: Intercepts when an entity death effect begins
   */
  EntityManager_startEntityDeathEffect(entityId: any, _options: any): void {
    const id = entityId | 0;
    if (id <= 0) return;
    const engaged = this.engagedTargets.get(id);
    if (engaged && !this.recentlyKilledEntities.has(id)) {
      this.handleNpcKilled(engaged);
      this.engagedTargets.delete(id);
    }
  }

  /**
   * Hook: Intercepts ground item creation
   */
  EntityManager_createGroundItem(id: any, itemId: any, quantity: any, x: any, z: any, floor: any, _y: any): void {
    this.correlateGroundItem(id | 0, itemId | 0, quantity | 0 || 1, Number(x) || 0, Number(z) || 0, floor | 0);
  }

  private pollGroundItems(): void {
    const em = this.em;
    const ground = em?.groundItems;
    if (!ground) return;

    for (const [, gi] of ground) {
      const gid = gi.id | 0;
      if (gid > 0 && !this.seenGroundItemIds.has(gid)) {
        this.correlateGroundItem(gid, gi.itemId | 0, gi.quantity | 0 || 1, gi.x || 0, gi.z || 0, gi.floor | 0);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Kill & Drop Correlation Logic
  // ---------------------------------------------------------------------------

  private handleNpcKilled(engaged: EngagedTarget): void {
    const now = Date.now();
    this.recentlyKilledEntities.add(engaged.entityId);
    this.killedEntityTimestamps.set(engaged.entityId, now);

    const killId = `${engaged.entityId}_${now}`;
    const pending: PendingKill = {
      killId,
      entityId: engaged.entityId,
      npcDefId: engaged.defId,
      npcName: engaged.name,
      combatLevel: engaged.combatLevel,
      deathTime: now,
      x: engaged.x,
      z: engaged.z,
      floor: engaged.floor,
      drops: [],
      finalized: false,
    };
    this.pendingKills.push(pending);

    // Increment kill count immediately so the denominator is strictly recorded
    this.recordKillInSession(engaged.name, engaged.defId, engaged.combatLevel);
    this.renderUI();
  }

  private correlateGroundItem(
    groundId: number,
    itemId: number,
    qty: number,
    x: number,
    z: number,
    floor: number
  ): void {
    if (itemId <= 0) return;
    if (groundId > 0 && this.seenGroundItemIds.has(groundId)) return;
    if (groundId > 0) this.seenGroundItemIds.add(groundId);

    const now = Date.now();
    const maxDist = Number(this.settings.matchDistance?.value) || 3;
    const dropWindowMs = (Number(this.settings.dropWindowSeconds?.value) || 8) * 1000;

    let bestKill: PendingKill | null = null;
    let bestDist = Infinity;

    for (const kill of this.pendingKills) {
      if (kill.finalized) continue;
      if (kill.floor !== floor) continue;
      if (now - kill.deathTime > dropWindowMs) continue;

      const d = dist(kill.x, kill.z, x, z);
      if (d <= maxDist && d < bestDist) {
        bestDist = d;
        bestKill = kill;
      }
    }

    if (bestKill) {
      const itemDef = this.getItemDef(itemId);
      const name = itemDef?.name ?? `Item #${itemId}`;
      const unitValue = itemDef?.value ?? itemDef?.shopPrice ?? 0;
      const totalVal = unitValue * qty;

      bestKill.drops.push({
        itemId,
        name,
        quantity: qty,
        value: totalVal,
      });

      this.recordDropInSession(bestKill.npcName, bestKill.npcDefId, bestKill.combatLevel, itemId, name, qty, totalVal);
      this.renderUI();
    }
  }

  private recordKillInSession(npcName: string, npcDefId: number, combatLevel: number): void {
    this.ensureData();
    const session: SessionData = this.data.session;
    session.totalKills += 1;

    const key = npcName;
    if (!session.monsters[key]) {
      session.monsters[key] = {
        npcDefId,
        npcName,
        combatLevel,
        killCount: 0,
        totalValue: 0,
        drops: {},
      };
    }
    session.monsters[key].killCount += 1;
  }

  private recordDropInSession(
    npcName: string,
    npcDefId: number,
    combatLevel: number,
    itemId: number,
    itemName: string,
    quantity: number,
    totalValue: number
  ): void {
    this.ensureData();
    const session: SessionData = this.data.session;
    session.totalValue += totalValue;

    const key = npcName;
    if (!session.monsters[key]) {
      session.monsters[key] = {
        npcDefId,
        npcName,
        combatLevel,
        killCount: 1,
        totalValue: 0,
        drops: {},
      };
    }

    const entry = session.monsters[key];
    entry.totalValue += totalValue;

    if (!entry.drops[itemId]) {
      entry.drops[itemId] = {
        itemId,
        name: itemName,
        quantity: 0,
        totalValue: 0,
      };
    }
    entry.drops[itemId].quantity += quantity;
    entry.drops[itemId].totalValue += totalValue;
  }

  // ---------------------------------------------------------------------------
  // Telemetry Dispatcher (Wiki Crowdsourcing)
  // ---------------------------------------------------------------------------

  private enqueueTelemetry(kill: PendingKill): void {
    if (!this.settings.submitToWiki?.value) return;

    this.telemetryQueue.push({
      npcDefId: kill.npcDefId,
      npcName: kill.npcName,
      combatLevel: kill.combatLevel,
      drops: kill.drops.map((d) => ({ itemId: d.itemId, itemName: d.name, quantity: d.quantity })),
      timestamp: Math.floor(kill.deathTime / 1000),
    });

    if (this.telemetryQueue.length >= 10) {
      void this.flushTelemetry();
    }
  }

  private async flushTelemetry(): Promise<void> {
    if (!this.settings.submitToWiki?.value || this.telemetryQueue.length === 0) {
      return;
    }

    const toSend = [...this.telemetryQueue];
    this.telemetryQueue = [];

    const endpoint = String(this.settings.telemetryEndpoint?.value || 'https://api.camelkit.dev/telemetry/drops');

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: 'CamelKit',
          version: '0.1.4',
          events: toSend,
        }),
      });

      if (resp.ok) {
        this.lastSyncTime = Date.now();
        this.syncStatus = 'synced';
      } else {
        this.syncStatus = 'offline';
        // Keep unsent events capped at 50 to avoid memory growth
        this.telemetryQueue = [...toSend.slice(-50), ...this.telemetryQueue];
      }
    } catch {
      this.syncStatus = 'offline';
      this.telemetryQueue = [...toSend.slice(-50), ...this.telemetryQueue];
    }

    this.updateSyncBadge();
  }

  // ---------------------------------------------------------------------------
  // User Interface (Sidebar Panel)
  // ---------------------------------------------------------------------------

  private renderUI(): void {
    if (!this.panelContainer) return;

    const session: SessionData = this.data.session || {
      startTime: Date.now(),
      totalKills: 0,
      totalValue: 0,
      monsters: {},
    };

    const monsterKeys = Object.keys(session.monsters || {}).sort((a, b) => {
      return session.monsters[b].totalValue - session.monsters[a].totalValue;
    });

    this.panelContainer.innerHTML = '';
    Object.assign(this.panelContainer.style, {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--theme-background)',
      color: 'var(--theme-text-primary)',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box',
      overflow: 'hidden',
    });

    // 1. Header Toolbar
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '12px',
      background: 'var(--theme-background-mute)',
      borderBottom: '1px solid var(--theme-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      flexShrink: '0',
    });

    const titleRow = document.createElement('div');
    Object.assign(titleRow.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    });

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';
    title.style.display = 'flex';
    title.style.alignItems = 'center';
    title.style.gap = '6px';
    title.innerHTML = '<span>📦</span><span>Loot Tracker</span>';

    const syncBadge = document.createElement('span');
    syncBadge.id = 'loot-tracker-sync-badge';
    this.styleSyncBadge(syncBadge);
    titleRow.appendChild(title);
    titleRow.appendChild(syncBadge);
    header.appendChild(titleRow);

    // Stats Row
    const statsRow = document.createElement('div');
    Object.assign(statsRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 10px',
      background: 'var(--theme-background-soft)',
      borderRadius: '6px',
      fontSize: '12px',
    });

    const totalKillsNum = Number(session.totalKills) || 0;
    const totalValueNum = Number(session.totalValue) || 0;

    const killsEl = document.createElement('div');
    killsEl.innerHTML = `<span style="color:var(--theme-text-muted)">Kills:</span> <b style="color:var(--theme-accent)">${totalKillsNum.toLocaleString()}</b>`;

    const valEl = document.createElement('div');
    valEl.innerHTML = `<span style="color:var(--theme-text-muted)">Value:</span> <b style="color:#ffd24a">${abbreviateValue(totalValueNum)} gp</b>`;

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '↻ Reset';
    resetBtn.title = 'Clear session loot';
    Object.assign(resetBtn.style, {
      background: 'transparent',
      border: '1px solid var(--theme-border)',
      color: 'var(--theme-text-muted)',
      borderRadius: '4px',
      padding: '2px 8px',
      fontSize: '11px',
      cursor: 'pointer',
    });
    resetBtn.onmouseenter = () => {
      resetBtn.style.color = 'var(--theme-text-primary)';
      resetBtn.style.borderColor = 'var(--theme-divider)';
    };
    resetBtn.onmouseleave = () => {
      resetBtn.style.color = 'var(--theme-text-muted)';
      resetBtn.style.borderColor = 'var(--theme-border)';
    };
    resetBtn.onclick = () => {
      if (confirm('Reset current Loot Tracker session?')) {
        this.resetSession();
      }
    };

    statsRow.appendChild(killsEl);
    statsRow.appendChild(valEl);
    statsRow.appendChild(resetBtn);
    header.appendChild(statsRow);
    this.panelContainer.appendChild(header);

    // 2. Scrollable Monster List
    const listContainer = document.createElement('div');
    Object.assign(listContainer.style, {
      flex: '1',
      overflowY: 'auto',
      padding: '10px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    });

    if (monsterKeys.length === 0) {
      const emptyBox = document.createElement('div');
      Object.assign(emptyBox.style, {
        padding: '30px 16px',
        textAlign: 'center',
        color: 'var(--theme-text-muted)',
        fontSize: '12px',
        lineHeight: '1.6',
        background: 'var(--theme-background-mute)',
        borderRadius: '8px',
        border: '1px dashed var(--theme-border)',
        margin: '10px 0',
      });
      emptyBox.innerHTML = `
        <div style="font-size:24px;margin-bottom:8px">⚔️</div>
        <div style="font-weight:600;color:var(--theme-text-primary);margin-bottom:4px">No Loot Recorded Yet</div>
        <div>Defeat monsters to track drops, calculate drop rates, and crowdsource data to the EvilQuest Wiki!</div>
      `;
      listContainer.appendChild(emptyBox);
    } else {
      for (const key of monsterKeys) {
        const monster = session.monsters[key];
        const card = this.createMonsterCard(monster);
        listContainer.appendChild(card);
      }
    }

    this.panelContainer.appendChild(listContainer);
  }

  private createMonsterCard(monster: MonsterSessionEntry): HTMLElement {
    const isCollapsed = Boolean(this.data.collapsed?.[monster.npcName]);

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'var(--theme-background-mute)',
      border: '1px solid var(--theme-border)',
      borderRadius: '6px',
      overflow: 'hidden',
      transition: 'border-color 0.15s ease',
    });

    // Card Header
    const cardHeader = document.createElement('div');
    Object.assign(cardHeader.style, {
      padding: '8px 10px',
      background: 'var(--theme-background-soft)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      cursor: 'pointer',
      userSelect: 'none',
    });

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '6px';

    const chevron = document.createElement('span');
    chevron.style.fontSize = '10px';
    chevron.style.color = 'var(--theme-text-muted)';
    chevron.textContent = isCollapsed ? '▶' : '▼';

    const nameEl = document.createElement('span');
    nameEl.style.fontWeight = '600';
    nameEl.style.fontSize = '12px';
    nameEl.textContent = monster.npcName;

    const levelBadge = document.createElement('span');
    levelBadge.style.fontSize = '10px';
    levelBadge.style.color = 'var(--theme-text-muted)';
    if (monster.combatLevel > 0) {
      levelBadge.textContent = `(Lvl ${monster.combatLevel})`;
    }

    left.appendChild(chevron);
    left.appendChild(nameEl);
    if (monster.combatLevel > 0) left.appendChild(levelBadge);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';
    right.style.fontSize = '11px';

    const kcBadge = document.createElement('span');
    kcBadge.style.color = 'var(--theme-accent)';
    kcBadge.style.fontWeight = '600';
    kcBadge.textContent = `×${monster.killCount}`;

    const totalValBadge = document.createElement('span');
    totalValBadge.style.color = '#ffd24a';
    totalValBadge.textContent = `${abbreviateValue(monster.totalValue)} gp`;

    right.appendChild(kcBadge);
    right.appendChild(totalValBadge);

    cardHeader.appendChild(left);
    cardHeader.appendChild(right);

    cardHeader.onclick = () => {
      this.data.collapsed[monster.npcName] = !isCollapsed;
      this.renderUI();
    };
    card.appendChild(cardHeader);

    // Card Body (Items Grid)
    if (!isCollapsed) {
      const dropItems = Object.values(monster.drops || {}).sort((a, b) => b.totalValue - a.totalValue);

      const grid = document.createElement('div');
      Object.assign(grid.style, {
        padding: '8px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))',
        gap: '6px',
      });

      if (dropItems.length === 0) {
        const noDrops = document.createElement('div');
        noDrops.style.gridColumn = '1 / -1';
        noDrops.style.fontSize = '11px';
        noDrops.style.color = 'var(--theme-text-muted)';
        noDrops.style.fontStyle = 'italic';
        noDrops.style.padding = '4px';
        noDrops.textContent = 'No item drops observed yet.';
        grid.appendChild(noDrops);
      } else {
        for (const drop of dropItems) {
          const slot = this.createItemSlot(drop, monster.killCount);
          grid.appendChild(slot);
        }
      }
      card.appendChild(grid);
    }

    return card;
  }

  private createItemSlot(drop: MonsterDropSummary, totalKills: number): HTMLElement {
    const slot = document.createElement('div');
    Object.assign(slot.style, {
      position: 'relative',
      width: '42px',
      height: '42px',
      background: 'rgba(0, 0, 0, 0.35)',
      border: '1px solid var(--theme-border)',
      borderRadius: '5px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'default',
    });

    const qty = Number(drop.quantity) || 0;
    const totalVal = Number(drop.totalValue) || 0;
    const dropRatePct = totalKills > 0 ? ((qty / totalKills) * 100).toFixed(1) : '0';
    slot.title = `${drop.name}\nQuantity: ${qty.toLocaleString()}\nTotal Value: ${totalVal.toLocaleString()} gp\nDrop Rate: ${qty}/${totalKills} (${dropRatePct}%)`;

    const img = document.createElement('img');
    const primaryUrl = this.getItemIconUrl(drop.itemId);
    const fallbackUrl = this.getItemFallbackIconUrl(drop.itemId);

    img.src = primaryUrl;
    Object.assign(img.style, {
      width: '32px',
      height: '32px',
      objectFit: 'contain',
      imageRendering: 'pixelated',
    });

    img.onerror = () => {
      if (img.src !== fallbackUrl) {
        img.src = fallbackUrl;
      }
    };
    slot.appendChild(img);

    // Quantity overlay
    const qtySpan = document.createElement('span');
    qtySpan.textContent = drop.quantity > 9999 ? abbreviateValue(drop.quantity) : String(drop.quantity);
    Object.assign(qtySpan.style, {
      position: 'absolute',
      right: '2px',
      bottom: '1px',
      fontSize: '10px',
      fontWeight: '700',
      color: '#ffffff',
      textShadow: '0 0 3px #000, 1px 1px 2px #000',
      pointerEvents: 'none',
    });
    slot.appendChild(qtySpan);

    return slot;
  }

  private styleSyncBadge(el: HTMLElement): void {
    const optIn = Boolean(this.settings.submitToWiki?.value);
    if (!optIn) {
      el.textContent = '⚪ Local Only';
      el.title = 'Wiki crowdsourcing is disabled in settings';
      Object.assign(el.style, {
        fontSize: '10px',
        padding: '2px 6px',
        borderRadius: '10px',
        background: 'rgba(255, 255, 255, 0.08)',
        color: 'var(--theme-text-muted)',
      });
      return;
    }

    if (this.syncStatus === 'synced') {
      el.textContent = '🟢 Wiki Synced';
      el.title = `Data synced. Last upload: ${new Date(this.lastSyncTime).toLocaleTimeString()}`;
      Object.assign(el.style, {
        fontSize: '10px',
        padding: '2px 6px',
        borderRadius: '10px',
        background: 'rgba(16, 185, 129, 0.15)',
        color: 'var(--theme-success)',
      });
    } else if (this.syncStatus === 'offline') {
      el.textContent = '⚠️ Offline Queue';
      el.title = 'Server unreachable; caching telemetry locally';
      Object.assign(el.style, {
        fontSize: '10px',
        padding: '2px 6px',
        borderRadius: '10px',
        background: 'rgba(239, 68, 68, 0.15)',
        color: 'var(--theme-danger)',
      });
    } else {
      el.textContent = '🟡 Wiki Telemetry';
      el.title = 'Crowdsourcing telemetry active';
      Object.assign(el.style, {
        fontSize: '10px',
        padding: '2px 6px',
        borderRadius: '10px',
        background: 'rgba(249, 244, 73, 0.15)',
        color: 'var(--theme-accent)',
      });
    }
  }

  private updateSyncBadge(): void {
    const badge = this.panelContainer?.querySelector<HTMLElement>('#loot-tracker-sync-badge');
    if (badge) {
      this.styleSyncBadge(badge);
    }
  }
}
