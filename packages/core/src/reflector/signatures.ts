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

import { ClassSignature, EnumSignature } from './types';

// Define the map of all class hook signatures
export const ClassSignatures: [string, ClassSignature][] = [
    // Define all the class signatures
    // GameManager is the top-level instance (window.gm). It is NOT a game-side singleton,
    // so its live instance is captured by the HookManager on first hooked-method call and
    // exposed as gameHooks.GameManager.Instance (see hookManager.registerClassHook).
    ['GameManager', { methods: ['updateMinimap', 'showPlayerChatBubble', 'worldObjectDisplayName', 'waitForCurrentLocalPlayerReady'] }],
    // EvilQuest's entity manager (class `ue`): NPCs, remote players, ground items.
    // Like GameManager it is not a static singleton, so the HookManager captures
    // its live instance on first hooked-method call -> gameHooks.EntityManager.Instance.
    ['EntityManager', { methods: ['createRemotePlayer', 'createNpc', 'findNearestNpc', 'createGroundItem', 'removeRemotePlayer'] }],
    ['GroundItemManager', { methods: ['createGroundItem', 'removeGroundItem', 'refreshGroundItemLabels'] }],
    ['MeshManager', { methods: ['hasTreeModel', 'getStump', 'hasStump'] }],
    ['WorldMapManager', { methods: ['installCompassStyles', 'setCompassClickHandler', 'drawMinimapMarkers'] }],
    ['AtmosphereManager', { methods: ['refreshFogDefines', 'dispose'] }],
    ['WorldEntityManager', { methods: ['createGroundItem', 'removeGroundItem', 'interpolateRemotePlayers'] }],
    ['SpellManager', { methods: ['setLearnedSpells', 'getAutocastDefinition', 'applyAutocastFromServer'] }],
    ['SpellMeshManager', { methods: ['buildGather', 'buildProjectile', 'buildIceImpact'] }],
    ['GameLoop', { methods: ['shouldRenderSceneFrame', 'updateRenderFrameUi'] }],
    ['ChatManager', { methods: ['focusChatFromGlobalEnter', 'shouldFocusChatFromGlobalEnter', 'buildUI'] }],
    ['RangeManager', { methods: ['prepareRendering', 'launch', 'createArrowRoot'] }],
    ['SocketManager', { methods: ['openSockets', 'sendMove', 'sendChat'] }],
    ['GameEngine', { methods: ['connectAndAuth', 'whenPreloaded'] }],
    ['ItemManager', { methods: ['countLocalInventoryItem', 'localHasEquippedItem', 'pickupItem'] }],
    ['LoginScreen', { methods: ['createRememberUsernameRow', 'createHomepageLink', 'createMusicControl'] }],
    ['PrivateChatMessageList', { methods: ['switchTab', 'handleEmoteAutocompleteKey', 'addMessage'] }],
    ['InventoryManager', { methods: ['setToolsControls', 'setAdminItemContextEnabled', 'buildUI'] }],
    ['UIManager', { methods: ['setToolsControls', 'setQuestDefs', 'setSocialLists'] }],
    ['BankUIManager', { methods: ['openWithContents', 'updateBankSlot', 'renderBankSlot'] }],
    ['NameplateManager', { methods: ['frameImageFor', 'portraitImageFor', 'drawFallbackFrame'] }],
    ['InventoryItemSpriteManager', { methods: ['updateBody', 'reposition', 'reveal'] }],
    ['SpriteSheetManager', { methods: ['ensureFloorLayer', 'mapResourceUrl'] }],
    ['GameCameraManager', { methods: ['applyGameplayView', 'lockedMinRadius', 'setLockedRadiusScale'] }],
    ['ItemDefinitionManager', { methods: ['connectAndAuth'], contains: 'this.itemDefs' }],
    ['NpcDefinitionManager', { methods: ['connectAndAuth'], contains: 'this.npcDefs' }],
    ['SpellDefinitionManager', { methods: ['setLearnedSpells', 'getAutocastDefinition'] }],
    ['AppearanceUtils', { methods: ['configureOwnedMeshCulling', 'applyRenderOpacityToMesh'] }],
    ['BlobLoader', { methods: ['clearPendingNpcWork', 'queueHumanoidModelWarmup'] }],
    ['HTMLUIManager', { methods: ['setToolsControls', 'setQuestDefs'] }],
    ['ScreenMask', { methods: ['setProgress', 'setStatus', 'resetProgress'] }],
    ['ContextMenuManager', { methods: ['showContextMenu', 'hideContextMenu', 'openWorldContextMenuAt'] }],
    ['ContextMenuItemManager', { methods: ['buildWorldContextMenuItems', 'getWorldInteractionOptionsAt'] }],
    ['TargetActionManager', { methods: ['handlePrimaryActionAt', 'pickGround', 'setGroundClickHandler'] }],
    ['MagicSkillManager', { methods: ['setLearnedSpells', 'usesItemCost'] }],
    ['SpellMenuManager', { methods: ['setLearnedSpells', 'getAutocastDefinition', 'applyAutocastFromServer'] }],
    ['QuestDefinitionManager', { methods: ['questStageRequirementText', 'questVarRequirementText', 'stageObjectiveText'] }],
    ['StatsMenuManager', { methods: ['setRenderQualityControls', 'setMovementModeControls', 'applyMovementModeFromServer'] }],
    ['GameMenuBarManager', { methods: ['setAuthToken', 'removeStaleMounts', 'setToolsControls'] }],
    ['ExperienceManager', { methods: ['setQuestDefs', 'setQuestState'] }]
];

// Define the map of all class hook signatures
export const EnumSignatures: [string, EnumSignature][] = [
    // Define all the statement signatures
    ['GameWorldActions', { includes: ['attack'] }],
    ['InventoryActions',  { includes: ['use', 'inspect', 'drop'] }],
    ['PlayerActions', { includes: ['idle'] }],
    ['Skills', { includes: ['hitpoints', 'woodcutting'] }],
    ['EntityTypes', { includes: ['environment', 'item'] }],
    ['AppearanceTypes', { includes: ['hair', 'beard'] }],
    ['UISettings', { includes: ['uitheme'] }],
    ['GameInterfaces', { includes: ['inventory', 'bank', 'shop'] }],
    ['GameObjects', { includes: ['caveentrance', 'caveexit', 'oaktree'] }],
    ['RequirementTypes', { includes: ['availableinventoryspace', 'quest', 'skill'] }],
    ['SpellTypes', { includes: ['combat', 'status', 'inventory', 'teleport'] }],
];
