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

// Define the map of all active client class signatures verified against Memories of Magic bundles
export const ClassSignatures: [string, ClassSignature][] = [
    // GameManager is the top-level instance (window.gm). It is NOT a game-side singleton,
    // so its live instance is captured by the HookManager on first hooked-method call and
    // exposed as gameHooks.GameManager.Instance (see hookManager.registerClassHook).
    ['GameManager', { methods: ['updateMinimap', 'showPlayerChatBubble', 'worldObjectDisplayName', 'waitForCurrentLocalPlayerReady'] }],
    // Entity manager (NPCs, remote players, ground items). Captured on first hooked call -> gameHooks.EntityManager.Instance.
    ['EntityManager', { methods: ['createRemotePlayer', 'createNpc', 'findNearestNpc', 'createGroundItem', 'removeRemotePlayer'] }],
    ['MeshManager', { methods: ['hasTreeModel', 'getStump', 'hasStump'] }],
    ['WorldMapManager', { methods: ['installCompassStyles', 'setCompassClickHandler', 'drawMinimapMarkers'] }],
    ['AtmosphereManager', { methods: ['refreshFogDefines', 'dispose'] }],
    ['SpellManager', { methods: ['setLearnedSpells', 'getAutocastDefinition', 'applyAutocastFromServer'] }],
    ['SpellMeshManager', { methods: ['buildGather', 'buildProjectile', 'buildIceImpact'] }],
    ['ChatManager', { methods: ['focusChatFromGlobalEnter', 'shouldFocusChatFromGlobalEnter', 'buildUI'] }],
    ['RangeManager', { methods: ['prepareRendering', 'launch', 'createArrowRoot'] }],
    ['SocketManager', { methods: ['openSockets', 'sendMove', 'sendChat'] }],
    ['LoginScreen', { methods: ['createRememberUsernameRow', 'createHomepageLink', 'createMusicControl'] }],
    ['UIManager', { methods: ['setToolsControls', 'setQuestDefs', 'setSocialLists'] }],
    ['InventoryManager', { methods: ['setToolsControls', 'setAdminItemContextEnabled', 'buildUI'] }],
    ['BankUIManager', { methods: ['openWithContents', 'updateBankSlot', 'renderBankSlot'] }],
    ['TradeUIManager', { methods: ['openSession', 'updateOffer', 'updateAcceptState', 'close'] }],
    ['DuelUIManager', { methods: ['openSession', 'updateStake', 'updateAcceptState', 'close'] }],
    ['ShopUIManager', { methods: ['canBuy', 'quote', 'selectItem', 'setOnClose'] }],
    ['DialogueUIManager', { methods: ['cancelDialogue', 'advance', 'chooseOption', 'closeSession'] }],
    ['MusicManager', { methods: ['setTrack', 'tryPlay', 'releaseAudio'] }],
    ['NameplateManager', { methods: ['frameImageFor', 'portraitImageFor', 'drawFallbackFrame'] }],
    ['InventoryItemSpriteManager', { methods: ['updateBody', 'reposition', 'reveal'] }],
    ['SpriteSheetManager', { methods: ['ensureFloorLayer', 'mapResourceUrl'] }],
    ['GameCameraManager', { methods: ['applyGameplayView', 'lockedMinRadius', 'setLockedRadiusScale'] }],
    ['AppearanceUtils', { methods: ['configureOwnedMeshCulling', 'applyRenderOpacityToMesh'] }],
    ['BlobLoader', { methods: ['clearPendingNpcWork', 'queueHumanoidModelWarmup'] }],
    ['ScreenMask', { methods: ['setProgress', 'setStatus', 'resetProgress'] }],
    ['TargetActionManager', { methods: ['handlePrimaryActionAt', 'pickGround', 'setGroundClickHandler'] }],
    ['QuestDefinitionManager', { methods: ['questStageRequirementText', 'questVarRequirementText', 'stageObjectiveText'] }],
    ['StatsMenuManager', { methods: ['setRenderQualityControls', 'setMovementModeControls', 'applyMovementModeFromServer'] }]
];

// Define the map of active client enum and lookup signatures verified against Memories of Magic bundles
export const EnumSignatures: [string, EnumSignature][] = [
    ['PlayerActions', { includes: ['idle', 'walk', 'attack'] }],
    ['Skills', { includes: ['hitpoints', 'woodcutting', 'weaponry'] }],
    ['CombatStyles', { includes: ['accurate', 'aggressive', 'defensive', 'controlled'] }],
    ['AppearanceTypes', { includes: ['haircolor', 'skincolor', 'eyecolor'] }],
    ['UISettings', { includes: ['grounditemlabels', 'nameplates', 'tooltips'] }],
    ['GameInterfaces', { includes: ['inventory', 'equipment', 'revealloot'] }],
    ['RequirementTypes', { includes: ['queststage', 'questcompleted', 'questvar'] }],
    ['EquipmentSlots', { includes: ['weapon', 'shield', 'head', 'body', 'legs'] }],
    ['Runes', { includes: ['chaos', 'death', 'blood'] }],
    ['ElementalTypes', { includes: ['arcane', 'earth', 'air'] }],
    ['ChatChannels', { includes: ['player', 'npc', 'world', 'private'] }],
    ['TileTypes', { includes: ['void', 'natural', 'path', 'lava'] }]
];
