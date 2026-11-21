// src/LootTrackerPlugin.ts
import { Plugin, SettingsTypes, PanelManager } from "@camelkit/core";

// src/utils/gameAccessors.ts
function dist(x1, z1, x2, z2) {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}
var GameAccessors = class {
  constructor(getGameHooks) {
    this.getGameHooks = getGameHooks;
  }
  get gm() {
    return this.getGameHooks()?.GameManager?.Instance ?? window.gm ?? null;
  }
  get em() {
    return this.getGameHooks()?.EntityManager?.Instance ?? window.em ?? this.gm?.entities ?? null;
  }
  getPlayerPosition() {
    const gm = this.gm;
    if (!gm) return null;
    return {
      x: gm.playerX ?? 0,
      z: gm.playerZ ?? 0,
      floor: gm.currentFloor ?? 0
    };
  }
  getNpcPosition(entityId) {
    const em = this.em;
    if (!em) return null;
    const sprite = em.npcSprites?.get(entityId);
    if (sprite?.position) {
      return { x: sprite.position.x, z: sprite.position.z };
    }
    const target = em.npcTargets?.get(entityId);
    if (target && typeof target.x === "number") {
      return { x: target.x, z: target.z };
    }
    return null;
  }
  getItemDef(itemId) {
    const em = this.em;
    return document.highlite?.gameHooks?.ItemDefinitionManager?._itemDefMap?.get(itemId) ?? em?.itemDefsCache?.get(itemId) ?? this.gm?.itemDefsCache?.get(itemId) ?? null;
  }
  getItemIconUrl(itemId) {
    const origin = typeof window !== "undefined" && window.location?.origin && window.location.origin.startsWith("http") ? window.location.origin : "https://memoriesofmagic.com";
    const def = this.getItemDef(itemId);
    if (def?.icon) {
      return `${origin}/items/${def.icon}`;
    }
    return `${origin}/items/3d/${itemId}.png`;
  }
  getItemFallbackIconUrl(itemId) {
    const origin = typeof window !== "undefined" && window.location?.origin && window.location.origin.startsWith("http") ? window.location.origin : "https://memoriesofmagic.com";
    return `${origin}/items/3d/${itemId}.png`;
  }
};

// src/services/SessionStore.ts
var SessionStore = class {
  constructor(getDataStore) {
    this.getDataStore = getDataStore;
  }
  ensureData() {
    const data = this.getDataStore();
    if (!data.session || typeof data.session !== "object") {
      data.session = {
        startTime: Date.now(),
        totalKills: 0,
        totalValue: 0,
        monsters: {}
      };
    }
    if (!data.collapsed || typeof data.collapsed !== "object") {
      data.collapsed = {};
    }
  }
  getSession() {
    this.ensureData();
    return this.getDataStore().session;
  }
  isCollapsed(npcName) {
    this.ensureData();
    return Boolean(this.getDataStore().collapsed?.[npcName]);
  }
  toggleCollapsed(npcName) {
    this.ensureData();
    const data = this.getDataStore();
    data.collapsed[npcName] = !data.collapsed[npcName];
  }
  resetSession() {
    const data = this.getDataStore();
    data.session = {
      startTime: Date.now(),
      totalKills: 0,
      totalValue: 0,
      monsters: {}
    };
  }
  recordKill(npcName, npcDefId, combatLevel) {
    const session = this.getSession();
    session.totalKills += 1;
    const key = npcName;
    if (!session.monsters[key]) {
      session.monsters[key] = {
        npcDefId,
        npcName,
        combatLevel,
        killCount: 0,
        totalValue: 0,
        drops: {}
      };
    }
    session.monsters[key].killCount += 1;
  }
  recordDrop(npcName, npcDefId, combatLevel, itemId, itemName, quantity, totalValue) {
    const session = this.getSession();
    session.totalValue += totalValue;
    const key = npcName;
    if (!session.monsters[key]) {
      session.monsters[key] = {
        npcDefId,
        npcName,
        combatLevel,
        killCount: 1,
        totalValue: 0,
        drops: {}
      };
    }
    const entry = session.monsters[key];
    entry.totalValue += totalValue;
    if (!entry.drops[itemId]) {
      entry.drops[itemId] = {
        itemId,
        name: itemName,
        quantity: 0,
        totalValue: 0
      };
    }
    entry.drops[itemId].quantity += quantity;
    entry.drops[itemId].totalValue += totalValue;
  }
};

// src/services/WikiTelemetry.ts
var WikiTelemetryService = class {
  constructor(config) {
    this.config = config;
    this.telemetryQueue = [];
    this.syncStatus = "pending";
    this.lastSyncTime = 0;
  }
  get queueLength() {
    return this.telemetryQueue.length;
  }
  enqueue(kill) {
    if (!this.config.isEnabled()) return;
    this.telemetryQueue.push({
      npcDefId: kill.npcDefId,
      npcName: kill.npcName,
      combatLevel: kill.combatLevel,
      drops: kill.drops.map((d) => ({ itemId: d.itemId, itemName: d.name, quantity: d.quantity })),
      timestamp: Math.floor(kill.deathTime / 1e3)
    });
    if (this.telemetryQueue.length >= 10) {
      void this.flush();
    }
  }
  async flush() {
    if (!this.config.isEnabled() || this.telemetryQueue.length === 0) {
      return;
    }
    const toSend = [...this.telemetryQueue];
    this.telemetryQueue = [];
    const endpoint = String(this.config.getEndpoint() || "https://api.camelkit.dev/telemetry/drops");
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: "CamelKit",
          version: this.config.getPluginVersion(),
          events: toSend
        })
      });
      if (resp.ok) {
        this.lastSyncTime = Date.now();
        this.syncStatus = "synced";
      } else {
        this.syncStatus = "offline";
        this.telemetryQueue = [...toSend.slice(-50), ...this.telemetryQueue];
      }
    } catch {
      this.syncStatus = "offline";
      this.telemetryQueue = [...toSend.slice(-50), ...this.telemetryQueue];
    }
    this.config.onStatusChange();
  }
};

// src/engine/CombatTracker.ts
var CombatTracker = class {
  constructor(opts) {
    this.opts = opts;
    this.engagedTargets = /* @__PURE__ */ new Map();
    this.recentlyKilledEntities = /* @__PURE__ */ new Set();
    this.killedEntityTimestamps = /* @__PURE__ */ new Map();
    this.pendingKills = [];
    this.seenGroundItemIds = /* @__PURE__ */ new Set();
  }
  clearPendingKills() {
    this.pendingKills = [];
  }
  tick() {
    const gm = this.opts.accessors.gm;
    const em = this.opts.accessors.em;
    if (!gm || !em) return;
    const now = Date.now();
    const playerPos = this.opts.accessors.getPlayerPosition();
    let targetId = -1;
    try {
      if (typeof gm.currentLocalNpcCombatTargetId === "function") {
        targetId = gm.currentLocalNpcCombatTargetId() | 0;
      } else if (gm.magicTargetId >= 0) {
        targetId = gm.magicTargetId | 0;
      } else if (gm.combatTargetId >= 0) {
        targetId = gm.combatTargetId | 0;
      } else if (gm.localNpcCombatEngagementTargetId >= 0) {
        targetId = gm.localNpcCombatEngagementTargetId | 0;
      }
    } catch {
    }
    if (targetId > 0) {
      const defId = em.npcDefs?.get(targetId) ?? -1;
      const def = em.npcDefsCache?.get(defId);
      const pos = this.opts.accessors.getNpcPosition(targetId);
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
        lastEngaged: now
      });
    }
    for (const [id, engaged] of this.engagedTargets) {
      if (em.npcDefs?.has(id) || em.npcSprites?.has(id)) {
        const pos = this.opts.accessors.getNpcPosition(id);
        if (pos) {
          engaged.x = pos.x;
          engaged.z = pos.z;
        }
      }
    }
    const maxKillDist = 12;
    for (const [id, engaged] of this.engagedTargets) {
      const isAlive = em.npcDefs?.has(id) || em.npcSprites?.has(id);
      if (!isAlive) {
        if (!this.recentlyKilledEntities.has(id)) {
          const timeSinceEngaged = now - engaged.lastEngaged;
          const distToPlayer = playerPos ? dist(engaged.x, engaged.z, playerPos.x, playerPos.z) : 0;
          if (timeSinceEngaged < 1e4 && distToPlayer <= maxKillDist) {
            this.handleNpcKilled(engaged);
          }
        }
        this.engagedTargets.delete(id);
      }
    }
    for (const [id, deathTime] of this.killedEntityTimestamps) {
      if (now - deathTime > 15e3) {
        this.killedEntityTimestamps.delete(id);
        this.recentlyKilledEntities.delete(id);
      }
    }
    const dropWindowMs = (Number(this.opts.getDropWindowSeconds()) || 8) * 1e3;
    for (let i = this.pendingKills.length - 1; i >= 0; i--) {
      const kill = this.pendingKills[i];
      if (now - kill.deathTime > dropWindowMs) {
        kill.finalized = true;
        this.opts.telemetry.enqueue(kill);
        this.pendingKills.splice(i, 1);
      }
    }
    this.pollGroundItems();
  }
  onEntityDeath(entityId) {
    const id = entityId | 0;
    if (id <= 0) return;
    const engaged = this.engagedTargets.get(id);
    if (engaged && !this.recentlyKilledEntities.has(id)) {
      this.handleNpcKilled(engaged);
      this.engagedTargets.delete(id);
    }
  }
  correlateGroundItem(groundId, itemId, qty, x, z, floor) {
    if (itemId <= 0) return;
    if (groundId > 0 && this.seenGroundItemIds.has(groundId)) return;
    if (groundId > 0) this.seenGroundItemIds.add(groundId);
    const now = Date.now();
    const maxDist = Number(this.opts.getMatchDistance()) || 3;
    const dropWindowMs = (Number(this.opts.getDropWindowSeconds()) || 8) * 1e3;
    let bestKill = null;
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
      const itemDef = this.opts.accessors.getItemDef(itemId);
      const name = itemDef?.name ?? `Item #${itemId}`;
      const unitValue = itemDef?.value ?? itemDef?.shopPrice ?? 0;
      const totalVal = unitValue * qty;
      bestKill.drops.push({
        itemId,
        name,
        quantity: qty,
        value: totalVal
      });
      this.opts.sessionStore.recordDrop(
        bestKill.npcName,
        bestKill.npcDefId,
        bestKill.combatLevel,
        itemId,
        name,
        qty,
        totalVal
      );
      this.opts.onSessionUpdated();
    }
  }
  pollGroundItems() {
    const em = this.opts.accessors.em;
    const ground = em?.groundItems;
    if (!ground) return;
    for (const [, gi] of ground) {
      const gid = gi.id | 0;
      if (gid > 0 && !this.seenGroundItemIds.has(gid)) {
        this.correlateGroundItem(gid, gi.itemId | 0, gi.quantity | 0 || 1, gi.x || 0, gi.z || 0, gi.floor | 0);
      }
    }
  }
  handleNpcKilled(engaged) {
    const now = Date.now();
    this.recentlyKilledEntities.add(engaged.entityId);
    this.killedEntityTimestamps.set(engaged.entityId, now);
    const killId = `${engaged.entityId}_${now}`;
    const pending = {
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
      finalized: false
    };
    this.pendingKills.push(pending);
    this.opts.sessionStore.recordKill(engaged.name, engaged.defId, engaged.combatLevel);
    this.opts.onSessionUpdated();
  }
};

// src/ui/LootTrackerPanel.ts
import { abbreviateValue } from "@camelkit/core";
var LootTrackerPanel = class {
  constructor(opts) {
    this.opts = opts;
    this.container = null;
  }
  setContainer(el) {
    this.container = el;
  }
  render() {
    if (!this.container) return;
    const session = this.opts.sessionStore.getSession();
    const monsterKeys = Object.keys(session.monsters || {}).sort((a, b) => {
      return session.monsters[b].totalValue - session.monsters[a].totalValue;
    });
    this.container.innerHTML = "";
    Object.assign(this.container.style, {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--theme-background)",
      color: "var(--theme-text-primary)",
      fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      boxSizing: "border-box",
      overflow: "hidden"
    });
    const header = document.createElement("div");
    Object.assign(header.style, {
      padding: "12px",
      background: "var(--theme-background-mute)",
      borderBottom: "1px solid var(--theme-border)",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      flexShrink: "0"
    });
    const titleRow = document.createElement("div");
    Object.assign(titleRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    });
    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.fontSize = "14px";
    title.style.display = "flex";
    title.style.alignItems = "center";
    title.style.gap = "6px";
    title.innerHTML = "<span>\u{1F4E6}</span><span>Loot Tracker</span>";
    const syncBadge = document.createElement("span");
    syncBadge.id = "loot-tracker-sync-badge";
    this.styleSyncBadge(syncBadge);
    titleRow.appendChild(title);
    titleRow.appendChild(syncBadge);
    header.appendChild(titleRow);
    const statsRow = document.createElement("div");
    Object.assign(statsRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "6px 10px",
      background: "var(--theme-background-soft)",
      borderRadius: "6px",
      fontSize: "12px"
    });
    const totalKillsNum = Number(session.totalKills) || 0;
    const totalValueNum = Number(session.totalValue) || 0;
    const killsEl = document.createElement("div");
    killsEl.innerHTML = `<span style="color:var(--theme-text-muted)">Kills:</span> <b style="color:var(--theme-accent)">${totalKillsNum.toLocaleString()}</b>`;
    const valEl = document.createElement("div");
    valEl.innerHTML = `<span style="color:var(--theme-text-muted)">Value:</span> <b style="color:#ffd24a">${abbreviateValue(totalValueNum)} gp</b>`;
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "\u21BB Reset";
    resetBtn.title = "Clear session loot";
    Object.assign(resetBtn.style, {
      background: "transparent",
      border: "1px solid var(--theme-border)",
      color: "var(--theme-text-muted)",
      borderRadius: "4px",
      padding: "2px 8px",
      fontSize: "11px",
      cursor: "pointer"
    });
    resetBtn.onmouseenter = () => {
      resetBtn.style.color = "var(--theme-text-primary)";
      resetBtn.style.borderColor = "var(--theme-divider)";
    };
    resetBtn.onmouseleave = () => {
      resetBtn.style.color = "var(--theme-text-muted)";
      resetBtn.style.borderColor = "var(--theme-border)";
    };
    resetBtn.onclick = () => {
      if (confirm("Reset current Loot Tracker session?")) {
        this.opts.onResetRequested();
      }
    };
    statsRow.appendChild(killsEl);
    statsRow.appendChild(valEl);
    statsRow.appendChild(resetBtn);
    header.appendChild(statsRow);
    this.container.appendChild(header);
    const listContainer = document.createElement("div");
    Object.assign(listContainer.style, {
      flex: "1",
      overflowY: "auto",
      padding: "10px 8px",
      display: "flex",
      flexDirection: "column",
      gap: "8px"
    });
    if (monsterKeys.length === 0) {
      const emptyBox = document.createElement("div");
      Object.assign(emptyBox.style, {
        padding: "30px 16px",
        textAlign: "center",
        color: "var(--theme-text-muted)",
        fontSize: "12px",
        lineHeight: "1.6",
        background: "var(--theme-background-mute)",
        borderRadius: "8px",
        border: "1px dashed var(--theme-border)",
        margin: "10px 0"
      });
      emptyBox.innerHTML = `
        <div style="font-size:24px;margin-bottom:8px">\u2694\uFE0F</div>
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
    this.container.appendChild(listContainer);
  }
  updateSyncBadge() {
    const badge = this.container?.querySelector("#loot-tracker-sync-badge");
    if (badge) {
      this.styleSyncBadge(badge);
    }
  }
  createMonsterCard(monster) {
    const isCollapsed = this.opts.sessionStore.isCollapsed(monster.npcName);
    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "var(--theme-background-mute)",
      border: "1px solid var(--theme-border)",
      borderRadius: "6px",
      overflow: "hidden",
      transition: "border-color 0.15s ease"
    });
    const cardHeader = document.createElement("div");
    Object.assign(cardHeader.style, {
      padding: "8px 10px",
      background: "var(--theme-background-soft)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      cursor: "pointer",
      userSelect: "none"
    });
    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "6px";
    const chevron = document.createElement("span");
    chevron.style.fontSize = "10px";
    chevron.style.color = "var(--theme-text-muted)";
    chevron.textContent = isCollapsed ? "\u25B6" : "\u25BC";
    const nameEl = document.createElement("span");
    nameEl.style.fontWeight = "600";
    nameEl.style.fontSize = "12px";
    nameEl.textContent = monster.npcName;
    const levelBadge = document.createElement("span");
    levelBadge.style.fontSize = "10px";
    levelBadge.style.color = "var(--theme-text-muted)";
    if (monster.combatLevel > 0) {
      levelBadge.textContent = `(Lvl ${monster.combatLevel})`;
    }
    left.appendChild(chevron);
    left.appendChild(nameEl);
    if (monster.combatLevel > 0) left.appendChild(levelBadge);
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";
    right.style.fontSize = "11px";
    const kcBadge = document.createElement("span");
    kcBadge.style.color = "var(--theme-accent)";
    kcBadge.style.fontWeight = "600";
    kcBadge.textContent = `\xD7${monster.killCount}`;
    const totalValBadge = document.createElement("span");
    totalValBadge.style.color = "#ffd24a";
    totalValBadge.textContent = `${abbreviateValue(monster.totalValue)} gp`;
    right.appendChild(kcBadge);
    right.appendChild(totalValBadge);
    cardHeader.appendChild(left);
    cardHeader.appendChild(right);
    cardHeader.onclick = () => {
      this.opts.sessionStore.toggleCollapsed(monster.npcName);
      this.render();
    };
    card.appendChild(cardHeader);
    if (!isCollapsed) {
      const dropItems = Object.values(monster.drops || {}).sort((a, b) => b.totalValue - a.totalValue);
      const grid = document.createElement("div");
      Object.assign(grid.style, {
        padding: "8px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(42px, 1fr))",
        gap: "6px"
      });
      if (dropItems.length === 0) {
        const noDrops = document.createElement("div");
        noDrops.style.gridColumn = "1 / -1";
        noDrops.style.fontSize = "11px";
        noDrops.style.color = "var(--theme-text-muted)";
        noDrops.style.fontStyle = "italic";
        noDrops.style.padding = "4px";
        noDrops.textContent = "No item drops observed yet.";
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
  createItemSlot(drop, totalKills) {
    const slot = document.createElement("div");
    Object.assign(slot.style, {
      position: "relative",
      width: "42px",
      height: "42px",
      background: "rgba(0, 0, 0, 0.35)",
      border: "1px solid var(--theme-border)",
      borderRadius: "5px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "default"
    });
    const qty = Number(drop.quantity) || 0;
    const totalVal = Number(drop.totalValue) || 0;
    const dropRatePct = totalKills > 0 ? (qty / totalKills * 100).toFixed(1) : "0";
    slot.title = `${drop.name}
Quantity: ${qty.toLocaleString()}
Total Value: ${totalVal.toLocaleString()} gp
Drop Rate: ${qty}/${totalKills} (${dropRatePct}%)`;
    const img = document.createElement("img");
    const primaryUrl = this.opts.accessors.getItemIconUrl(drop.itemId);
    const fallbackUrl = this.opts.accessors.getItemFallbackIconUrl(drop.itemId);
    img.src = primaryUrl;
    Object.assign(img.style, {
      width: "32px",
      height: "32px",
      objectFit: "contain",
      imageRendering: "pixelated"
    });
    img.onerror = () => {
      if (img.src !== fallbackUrl) {
        img.src = fallbackUrl;
      }
    };
    slot.appendChild(img);
    const qtySpan = document.createElement("span");
    qtySpan.textContent = drop.quantity > 9999 ? abbreviateValue(drop.quantity) : String(drop.quantity);
    Object.assign(qtySpan.style, {
      position: "absolute",
      right: "2px",
      bottom: "1px",
      fontSize: "10px",
      fontWeight: "700",
      color: "#ffffff",
      textShadow: "0 0 3px #000, 1px 1px 2px #000",
      pointerEvents: "none"
    });
    slot.appendChild(qtySpan);
    return slot;
  }
  styleSyncBadge(el) {
    const optIn = this.opts.isWikiOptIn();
    if (!optIn) {
      el.textContent = "\u26AA Local Only";
      el.title = "Wiki crowdsourcing is disabled in settings";
      Object.assign(el.style, {
        fontSize: "10px",
        padding: "2px 6px",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.08)",
        color: "var(--theme-text-muted)"
      });
      return;
    }
    if (this.opts.telemetry.syncStatus === "synced") {
      el.textContent = "\u{1F7E2} Wiki Synced";
      el.title = `Data synced. Last upload: ${new Date(this.opts.telemetry.lastSyncTime).toLocaleTimeString()}`;
      Object.assign(el.style, {
        fontSize: "10px",
        padding: "2px 6px",
        borderRadius: "10px",
        background: "rgba(16, 185, 129, 0.15)",
        color: "var(--theme-success)"
      });
    } else if (this.opts.telemetry.syncStatus === "offline") {
      el.textContent = "\u26A0\uFE0F Offline Queue";
      el.title = "Server unreachable; caching telemetry locally";
      Object.assign(el.style, {
        fontSize: "10px",
        padding: "2px 6px",
        borderRadius: "10px",
        background: "rgba(239, 68, 68, 0.15)",
        color: "var(--theme-danger)"
      });
    } else {
      el.textContent = "\u{1F7E1} Wiki Telemetry";
      el.title = "Crowdsourcing telemetry active";
      Object.assign(el.style, {
        fontSize: "10px",
        padding: "2px 6px",
        borderRadius: "10px",
        background: "rgba(249, 244, 73, 0.15)",
        color: "var(--theme-accent)"
      });
    }
  }
};

// src/LootTrackerPlugin.ts
var LootTrackerPlugin = class extends Plugin {
  constructor() {
    super();
    this.pluginName = "Loot Tracker";
    this.author = "CamelKit";
    this.version = true ? "1.0.0" : typeof __CAMELKIT_VERSION__ !== "undefined" ? __CAMELKIT_VERSION__ : packageVersion;
    this.panelManager = new PanelManager();
    this.menuIconElement = null;
    this.engineTimer = null;
    this.telemetryTimer = null;
    this.accessors = new GameAccessors(() => this.gameHooks);
    this.sessionStore = new SessionStore(() => this.data);
    this.settings.enable = {
      text: "Enable Loot Tracker",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.onToggleEnabled()
    };
    this.settings.submitToWiki = {
      text: "Contribute Anonymous Drops to Wiki",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => {
        this.telemetry.syncStatus = this.settings.submitToWiki.value ? "pending" : "opted_out";
        this.panel.render();
      }
    };
    this.settings.matchDistance = {
      text: "Loot Matching Radius (Tiles)",
      type: SettingsTypes.range,
      value: 3,
      min: 1,
      max: 8,
      callback: () => {
      }
    };
    this.settings.dropWindowSeconds = {
      text: "Loot Matching Window (Seconds)",
      type: SettingsTypes.range,
      value: 8,
      min: 3,
      max: 20,
      callback: () => {
      }
    };
    this.settings.telemetryEndpoint = {
      text: "Wiki Telemetry URL",
      type: SettingsTypes.text,
      value: "https://api.camelkit.dev/telemetry/drops",
      callback: () => {
      }
    };
    this.settings.resetSessionOnLogin = {
      text: "Reset Session On Login",
      type: SettingsTypes.checkbox,
      value: false,
      callback: () => {
      }
    };
    this.telemetry = new WikiTelemetryService({
      isEnabled: () => Boolean(this.settings.submitToWiki?.value),
      getEndpoint: () => String(this.settings.telemetryEndpoint?.value || "https://api.camelkit.dev/telemetry/drops"),
      getPluginVersion: () => this.version,
      onStatusChange: () => this.panel.updateSyncBadge()
    });
    this.combatTracker = new CombatTracker({
      accessors: this.accessors,
      sessionStore: this.sessionStore,
      telemetry: this.telemetry,
      getMatchDistance: () => Number(this.settings.matchDistance?.value) || 3,
      getDropWindowSeconds: () => Number(this.settings.dropWindowSeconds?.value) || 8,
      onSessionUpdated: () => this.panel.render()
    });
    this.panel = new LootTrackerPanel({
      accessors: this.accessors,
      sessionStore: this.sessionStore,
      telemetry: this.telemetry,
      isWikiOptIn: () => Boolean(this.settings.submitToWiki?.value),
      onResetRequested: () => this.resetSession()
    });
  }
  init() {
    this.sessionStore.ensureData();
    if (this.settings.resetSessionOnLogin?.value) {
      this.resetSession();
    }
  }
  start() {
    this.info("start() called");
    this.sessionStore.ensureData();
    try {
      this.panelManager.removeMenuItem("\u{1F4E6}");
    } catch {
    }
    try {
      const [iconEl, panelEl] = this.panelManager.requestMenuItem("\u{1F4E6}", "Loot Tracker");
      this.menuIconElement = iconEl;
      this.panel.setContainer(panelEl);
      if (this.menuIconElement) {
        this.menuIconElement.title = "Loot Tracker";
      }
    } catch (e) {
      this.warn("Failed to register sidebar menu item:", e);
    }
    this.startEngine();
    this.panel.render();
    this.info("Loot Tracker started.");
  }
  stop() {
    this.stopEngine();
    if (this.telemetry.queueLength > 0 && this.settings.submitToWiki?.value) {
      void this.telemetry.flush();
    }
    try {
      this.panelManager.removeMenuItem("\u{1F4E6}");
    } catch {
    }
    this.menuIconElement = null;
    this.panel.setContainer(null);
    this.info("Loot Tracker stopped.");
  }
  resetSession() {
    this.sessionStore.resetSession();
    this.combatTracker.clearPendingKills();
    this.panel.render();
  }
  onToggleEnabled() {
    if (this.settings.enable.value) {
      this.start();
    } else {
      this.stop();
    }
  }
  startEngine() {
    this.stopEngine();
    this.engineTimer = setInterval(() => this.combatTracker.tick(), 120);
    this.telemetryTimer = setInterval(() => void this.telemetry.flush(), 45e3);
  }
  stopEngine() {
    if (this.engineTimer) {
      clearInterval(this.engineTimer);
      this.engineTimer = null;
    }
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
  }
  /**
   * Hook: Intercepts when the game initiates NPC death sequence
   */
  EntityManager_startNpcDeathSequence(entityId, _sprite, _options) {
    this.combatTracker.onEntityDeath(entityId | 0);
  }
  /**
   * Hook: Intercepts when an entity death effect begins
   */
  EntityManager_startEntityDeathEffect(entityId, _options) {
    this.combatTracker.onEntityDeath(entityId | 0);
  }
  /**
   * Hook: Intercepts ground item creation
   */
  EntityManager_createGroundItem(id, itemId, quantity, x, z, floor, _y) {
    this.combatTracker.correlateGroundItem(
      id | 0,
      itemId | 0,
      quantity | 0 || 1,
      Number(x) || 0,
      Number(z) || 0,
      floor | 0
    );
  }
};
export {
  LootTrackerPlugin,
  LootTrackerPlugin as default
};
//# sourceMappingURL=plugin.js.map
