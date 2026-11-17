// Compatibility facade. Prefer lrs:rune, lrs:card, lrs:boardgame.
export {LRS_MODULE as LRUNE_MODULE} from '../lrs/manifest.mjs';
export {runeAssetUrl,RUNE_WEB_ASSET_ORIGIN} from '../lrs/rune/asset-url.mjs';
export {createLunaRunesGame} from '../lrs/boardgame/boardgame-rules.js';
export {localTabletopRules} from '../lrs/boardgame/game-data.js';
export {RUNE_DRAW_MODES,RUNE_CUSTOM_DRAW_MODES,RUNE_ALL_DRAW_MODES} from '../lrs/card/rune-draw-modes.mjs';
export {cardGuidanceWeight,evaluateSpreadXY,buildSpreadAdvice} from '../lrs/card/rune-guidance-engine.mjs';
