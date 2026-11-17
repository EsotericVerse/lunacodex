/**
 * Each of the 66 Rune words retains seven unique, hand-authored poses.
 * Visual mass is reviewed separately from meaning: ethereal/soft forms glide,
 * anchored forms settle with inertia, impacts stop with minimal rebound.
 * Kinetic weight changes TIME and momentum, not all poses by a common multiplier.
 * The separate 66 licensed Effekseer scenes are never remapped here.
 */
export const GLYPH_MOTION_TIMES=Object.freeze([0,.14,.29,.52,.71,.88,1]);
// Deliberately separate temporal rhythm from shape. These are perceptual
// mass categories, NOT substitutes for the 66 individual rune animations.
// All time arrays are normalized seven-frame easings for Framer Motion.
export const RUNE_KINETIC_TIMING=Object.freeze({
  ethereal:Object.freeze({times:[0,.18,.36,.56,.74,.9,1],durationFactor:1.12,ease:'easeInOut'}),
  tender:Object.freeze({times:[0,.17,.34,.55,.74,.9,1],durationFactor:1.06,ease:'easeInOut'}),
  fluid:Object.freeze({times:[0,.15,.31,.52,.72,.89,1],durationFactor:1.04,ease:'easeInOut'}),
  measured:Object.freeze({times:[0,.13,.29,.48,.65,.83,1],durationFactor:1,ease:'easeInOut'}),
  anchored:Object.freeze({times:[0,.12,.25,.39,.56,.8,1],durationFactor:.94,ease:'easeOut'}),
  impact:Object.freeze({times:[0,.2,.35,.44,.56,.77,1],durationFactor:.88,ease:'easeIn'}),
  incisive:Object.freeze({times:[0,.12,.25,.43,.63,.82,1],durationFactor:.91,ease:'easeOut'}),
  energetic:Object.freeze({times:[0,.12,.27,.47,.64,.81,1],durationFactor:.93,ease:'easeInOut'}),
  fragile:Object.freeze({times:[0,.13,.27,.43,.61,.81,1],durationFactor:.91,ease:'easeInOut'})
});

export const RUNE_GLYPH_MOTION_PRESETS=Object.freeze({
  1: Object.freeze({name:'spirit-wisp',x:[-14,-10,-3,6,8,3,0],y:[10,2,-6,-11,-7,-2,0],rotate:[-3,-1,2,3,-1,0,0],weight:'ethereal'}), // Spirit
  2: Object.freeze({name:'soul-lift',x:[1,0,0,1,0,0,0],y:[23,16,7,-3,-8,-2,0],scale:[0.96,0.97,0.99,1,1.01,1,1],weight:'ethereal'}), // Soul
  3: Object.freeze({name:'spectrum-prism',x:[-8,5,-5,5,-3,1,0],rotate:[-6,4,-3,2,0,0,0],opacity:[0,0.88,0.52,1,0.69,0.96,1],weight:'ethereal'}), // Spectrum
  4: Object.freeze({name:'memory-echo',x:[-9,-5,1,-3,0,0,0],y:[7,3,0,-2,0,0,0],opacity:[0,0.4,0.9,0.32,0.87,1,1],weight:'tender'}), // Memory
  5: Object.freeze({name:'boundary-halt',x:[-32,-16,-3,0,0,0,0],scale:[0.97,0.99,1,1,1,1,1],weight:'anchored'}), // Boundary
  6: Object.freeze({name:'domain-establish',y:[-24,-16,-7,2,0,0,0],scale:[0.9,0.95,0.99,1.03,1,1,1],weight:'anchored'}), // Domain
  7: Object.freeze({name:'mirror-reversal',x:[-12,-6,5,-4,1,0,0],rotate:[-3,0,3,-3,1,0,0],weight:'tender'}), // Mirror
  8: Object.freeze({name:'core-pressure',scale:[0.94,0.98,1.025,0.98,1.03,1,1],opacity:[0,0.65,1,0.85,1,1,1],weight:'anchored'}), // Core
  9: Object.freeze({name:'path-forward',x:[-30,-20,-8,5,-2,0,0],y:[7,3,-2,0,1,0,0],weight:'measured'}), // Path
  10: Object.freeze({name:'sever-cut',x:[24,8,-26,10,0,0,0],rotate:[8,4,-12,5,0,0,0],opacity:[0,0.96,1,0.7,1,1,1],weight:'incisive'}), // Sever
  11: Object.freeze({name:'seal-imprint',y:[-24,-14,-5,2,0,0,0],scale:[0.95,0.98,1.02,0.99,1,1,1],weight:'anchored'}), // Seal
  12: Object.freeze({name:'chain-tension',x:[-18,-9,2,-5,1,-1,0],rotate:[-8,-5,2,-4,1,0,0],weight:'measured'}), // Chain
  13: Object.freeze({name:'awaken-opening',y:[16,7,-6,-10,-4,0,0],scale:[0.91,0.95,0.98,1.03,1,1,1],opacity:[0,0.25,0.82,1,1,1,1],weight:'tender'}), // Awaken
  14: Object.freeze({name:'separation-part',x:[21,13,-11,-21,-6,0,0],y:[0,-3,1,0,0,0,0],opacity:[0,0.7,1,0.8,1,1,1],weight:'incisive'}), // Separation
  15: Object.freeze({name:'insight-sudden',x:[0,0,5,-2,0,0,0],scale:[0.97,0.99,1,1.035,1,1,1],opacity:[0,0.16,1,0.72,1,1,1],weight:'ethereal'}), // Insight
  16: Object.freeze({name:'error-dislocation',x:[0,-8,10,-11,7,-3,0],y:[0,4,-5,3,-4,1,0],rotate:[0,-4,6,-6,3,0,0],weight:'incisive'}), // Error
  17: Object.freeze({name:'birth-emergence',y:[35,24,10,-3,-8,-2,0],scale:[0.78,0.85,0.93,1.015,1.02,1,1],opacity:[0,0.3,0.65,1,1,1,1],weight:'tender'}), // Birth
  18: Object.freeze({name:'aging-weight',y:[-11,-5,0,9,14,4,0],rotate:[0,1,2,4,5,1,0],scale:[1,1,0.98,0.955,0.94,0.95,0.94],weight:'anchored'}), // Aging
  19: Object.freeze({name:'illness-atrophy-tremor',x:[0,-2.5,3,-3,2.5,-2,0],y:[0,1,2,3,4,4,4],rotate:[0,-2,2,-2.5,2,-1,0],scale:[1,0.965,0.91,0.855,0.81,0.77,0.76],opacity:[0,0.78,0.9,0.7,0.85,0.8,1],weight:'fragile'}), // Illness
  20: Object.freeze({name:'death-quiet-fall',y:[-19,-12,-5,1,7,7,7],rotate:[-2,-2,-3,-4,-4,-3,-3],scale:[1,0.985,0.96,0.93,0.9,0.89,0.88],opacity:[0,1,0.88,0.55,0.3,0.6,1],weight:'anchored'}), // Death
  21: Object.freeze({name:'heart-double-beat',y:[2,-1,1,-1,0,0,0],scale:[0.97,1.04,0.99,1.045,0.98,1,1],weight:'tender'}), // Heart
  22: Object.freeze({name:'love-tender-near',x:[-11,-7,-3,2,1,0,0],y:[4,2,-1,-2,0,0,0],rotate:[-3,-2,0,1,0,0,0],weight:'tender'}), // Love
  23: Object.freeze({name:'language-ink-writing',x:[-24,-15,-5,2,-1,0,0],y:[5,0,3,-2,0,0,0],opacity:[0,0.35,0.7,0.95,1,1,1],weight:'measured'}), // Language
  24: Object.freeze({name:'resonance-standing-wave',x:[0,8,-10,7,-5,2,0],rotate:[0,3,-4,3,-2,0,0],scale:[1,1.03,0.98,1.035,0.985,1,1],weight:'fluid'}), // Resonance
  25: Object.freeze({name:'tree-trunk-grow',y:[32,23,12,1,-6,-2,0],scale:[0.88,0.92,0.97,1,1.02,1,1],weight:'anchored'}), // Tree
  26: Object.freeze({name:'blossom-unfurl',x:[0,6,-5,1,0,0,0],rotate:[-6,-4,1,4,-1,0,0],scale:[0.92,0.96,0.99,1.03,1.01,1,1],weight:'tender'}), // Blossom
  27: Object.freeze({name:'leaf-wind-dance',x:[-14,-5,10,-8,7,3,0],y:[9,-2,-8,-11,-7,-3,0],rotate:[-8,6,-5,7,-4,2,0],weight:'ethereal'}), // Leaf
  28: Object.freeze({name:'grass-bend-back',x:[0,4,7,3,-4,-1,0],y:[4,0,-3,1,0,0,0],rotate:[-2,5,7,4,-5,-1,0],weight:'tender'}), // Grass
  29: Object.freeze({name:'root-bury',y:[-26,-17,-7,1,5,2,0],rotate:[-2,0,2,0,0,0,0],scale:[0.98,0.99,1,1.015,1,1,1],weight:'anchored'}), // Root
  30: Object.freeze({name:'seed-drop-sprout',y:[-20,-12,2,6,3,-4,0],rotate:[-6,-3,2,0,1,0,0],scale:[0.94,0.97,0.99,1.02,1.03,1,1],weight:'tender'}), // Seed
  31: Object.freeze({name:'fruit-gravity-bounce',y:[-31,-21,-9,2,5,2,0],rotate:[-3,-2,0,3,-2,1,0],scale:[1,1,1,0.955,1.01,1,1],weight:'impact'}), // Fruit
  32: Object.freeze({name:'branch-reaching',x:[-10,-5,1,11,6,2,0],y:[18,11,3,-5,-6,-2,0],rotate:[-7,-4,-1,3,5,1,0],weight:'measured'}), // Branch
  33: Object.freeze({name:'gold-heavy-gleam',y:[-19,-13,-4,3,0,0,0],scale:[0.96,1,1.02,1,1,1,1],opacity:[0,0.55,1,0.83,1,1,1],weight:'anchored'}), // Gold
  34: Object.freeze({name:'jade-silk-sheen',x:[-7,-3,2,5,2,0,0],y:[3,0,-2,1,0,0,0],opacity:[0,0.72,0.86,1,0.91,1,1],weight:'tender'}), // Jade
  35: Object.freeze({name:'crystal-facet-shift',x:[-6,5,-3,2,0,0,0],rotate:[-6,2,-4,3,-1,0,0],opacity:[0,0.62,1,0.63,1,1,1],weight:'tender'}), // Crystal
  36: Object.freeze({name:'land-horizon-still',y:[-11,-6,-2,1,0,0,0],scale:[0.93,0.97,1.01,1,1,1,1],weight:'anchored'}), // Land
  37: Object.freeze({name:'stone-heavy-impact',y:[-30,-21,-9,3,5,1,0],rotate:[-3,-2,1,3,-1,0,0],scale:[1,1,0.99,0.945,1.01,1,1],weight:'impact'}), // Stone
  38: Object.freeze({name:'diamond-four-glints',x:[-3,4,-4,2,-1,0,0],rotate:[-2,3,-3,2,0,0,0],opacity:[0,0.88,0.45,1,0.55,0.98,1],weight:'measured'}), // Diamond
  39: Object.freeze({name:'ore-extraction-rise',x:[10,4,0,-3,1,0,0],y:[31,22,9,-5,-3,0,0],rotate:[7,4,-2,0,0,0,0],weight:'anchored'}), // Ore
  40: Object.freeze({name:'dust-speck-scatter',x:[-31,-17,6,24,12,4,0],y:[5,-3,-12,-17,-10,-2,0],opacity:[0,0.44,0.89,0.58,0.81,1,1],weight:'ethereal'}), // Dust
  41: Object.freeze({name:'radiance-halo-bloom',scale:[0.91,0.97,1.035,1,1.04,1,1],opacity:[0,0.37,0.87,1,0.96,1,1],weight:'ethereal'}), // Radiance
  42: Object.freeze({name:'shadow-wall-creep',x:[22,16,8,1,-3,-1,0],y:[6,4,2,0,-1,0,0],opacity:[0,0.24,0.52,0.77,0.91,1,1],weight:'ethereal'}), // Shadow
  43: Object.freeze({name:'water-tide-ripple',x:[-17,-7,10,17,2,-7,0],y:[5,-7,3,-8,2,-2,0],rotate:[-5,3,6,-4,-2,0,0],weight:'fluid'}), // Water
  44: Object.freeze({name:'flame-tongue-climb',x:[-6,3,-5,6,-3,2,0],y:[36,21,5,-12,-17,-5,0],scale:[0.91,0.98,1.04,0.985,1.03,1,1],opacity:[0,0.7,1,0.82,1,1,1],weight:'energetic'}), // Flame
  45: Object.freeze({name:'wind-crosscurrent',x:[-44,-27,5,28,9,-4,0],y:[11,-6,-3,5,-5,0,0],rotate:[-11,6,-7,4,-2,0,0],weight:'energetic'}), // Wind
  46: Object.freeze({name:'earth-deep-anchor',y:[-22,-14,-5,1,0,0,0],scale:[1,0.99,0.975,1.015,1,1,1],weight:'anchored'}), // Earth
  47: Object.freeze({name:'thunder-bolt-snap',x:[0,-6,12,-9,4,0,0],y:[-30,-20,12,-4,1,0,0],rotate:[-14,6,-12,8,-2,0,0],opacity:[0,0.38,1,0.5,1,1,1],weight:'impact'}), // Thunder
  48: Object.freeze({name:'air-updraft-breath',x:[-17,-9,2,9,3,-2,0],y:[16,6,-7,-14,-6,-2,0],scale:[1,1.01,1.02,0.99,1,1,1],weight:'ethereal'}), // Air
  49: Object.freeze({name:'sun-over-horizon',y:[29,20,12,3,-5,-2,0],scale:[0.95,0.98,1,1.02,1,1,1],opacity:[0,0.35,0.65,0.89,1,1,1],weight:'measured'}), // Sun
  50: Object.freeze({name:'moon-crescent-orbit',x:[-17,-13,-4,8,6,2,0],y:[8,2,-5,-7,-2,0,0],rotate:[-7,-4,2,5,1,0,0],weight:'ethereal'}), // Moon
  51: Object.freeze({name:'star-three-twinkles',x:[-2,2,-3,4,-2,1,0],scale:[1,1.02,0.99,1.035,0.98,1,1],opacity:[0,0.96,0.4,1,0.56,0.96,1],weight:'ethereal'}), // Star
  52: Object.freeze({name:'phase-wax-wane',rotate:[-5,-3,0,5,3,0,0],scale:[0.91,0.97,1.03,0.95,1.04,1,1],opacity:[0,0.45,0.92,0.55,1,1,1],weight:'fluid'}), // Phase
  53: Object.freeze({name:'clarity-sharpen-reveal',x:[10,5,-1,0,0,0,0],y:[4,2,0,0,0,0,0],opacity:[0,0.18,0.52,0.83,1,1,1],weight:'ethereal'}), // Clarity
  54: Object.freeze({name:'time-clock-pendulum',x:[-6,0,7,-8,5,0,0],y:[-3,1,-2,2,-1,0,0],rotate:[-16,-7,11,-12,8,-4,0],weight:'measured'}), // Time
  55: Object.freeze({name:'space-dimensional-fold',x:[-26,18,-12,9,-4,1,0],y:[-14,6,-6,4,-2,0,0],scale:[0.84,0.96,1.04,0.95,1.02,1,1],weight:'fluid'}), // Space
  56: Object.freeze({name:'reason-geometric-align',x:[11,6,0,-3,0,0,0],rotate:[8,5,2,-1,0,0,0],scale:[0.97,1,1.02,1,1,1,1],weight:'measured'}), // Reason
  57: Object.freeze({name:'blessing-gentle-descent',x:[4,2,0,-2,0,0,0],y:[-17,-11,-5,0,2,0,0],opacity:[0,0.36,0.7,0.91,1,1,1],weight:'tender'}), // Blessing
  58: Object.freeze({name:'calamity-shattering-impact',x:[0,-7,9,-11,5,0,0],y:[-40,-30,-14,27,9,-2,0],rotate:[-9,4,-12,8,-3,0,0],weight:'impact'}), // Calamity
  59: Object.freeze({name:'blank-negative-space',x:[0,0,0,0,0,0,0],scale:[0.98,0.97,0.96,0.97,0.99,1,1],opacity:[0,0.08,0.28,0.4,0.65,0.92,1],weight:'ethereal'}), // Blank
  60: Object.freeze({name:'dream-lullaby-float',x:[-16,-6,10,4,-7,-2,0],y:[17,3,-14,-8,5,2,0],rotate:[-7,-3,5,2,-3,0,0],opacity:[0,0.43,0.88,0.72,1,1,1],weight:'ethereal'}), // Dream
  61: Object.freeze({name:'illusion-double-mirage',x:[0,14,-12,9,-5,1,0],rotate:[0,4,-5,3,-1,0,0],opacity:[0,0.84,0.24,1,0.42,0.92,1],weight:'ethereal'}), // Illusion
  62: Object.freeze({name:'karma-return-cycle',x:[-19,-8,11,19,-10,3,0],y:[4,-5,-4,7,1,0,0],rotate:[-7,3,8,-4,5,0,0],weight:'measured'}), // Karma
  63: Object.freeze({name:'void-inward-collapse',x:[24,15,5,-3,0,0,0],y:[-19,-10,-4,1,0,0,0],scale:[1,0.95,0.88,0.8,0.73,0.77,0.79],opacity:[0,0.83,0.88,0.44,0.7,0.95,1],weight:'anchored'}), // Void
  64: Object.freeze({name:'result-convergence-resolve',x:[-14,-7,3,-2,1,0,0],y:[12,5,-4,3,0,0,0],scale:[0.95,0.98,1.01,1.02,1,1,1],weight:'anchored'}), // Result
  65: Object.freeze({name:'chaos-fractal-jolt',x:[-29,21,-23,17,-12,4,0],y:[11,-18,14,-7,10,-2,0],rotate:[-14,16,-18,12,-8,3,0],opacity:[0,0.91,0.61,1,0.73,1,1],weight:'energetic'}), // Chaos
  66: Object.freeze({name:'fate-thread-tighten',x:[-13,-8,4,-4,1,0,0],y:[-6,2,-3,1,0,0,0],rotate:[-5,3,-3,2,-1,0,0],scale:[0.94,0.98,1.02,0.99,1,1,1],weight:'measured'}), // Fate
});
export const GLYPH_MOTION_STYLES=Object.freeze(
  Object.values(RUNE_GLYPH_MOTION_PRESETS).map(entry=>entry.name)
);
export const RUNE_GLYPH_MOTION_BY_ID=Object.freeze(
  Object.fromEntries(Object.entries(RUNE_GLYPH_MOTION_PRESETS)
    .map(([id,entry])=>[id,entry.name]))
);
const zero=Object.freeze([0,0,0,0,0,0,0]);
const unit=Object.freeze([1,1,1,1,1,1,1]);
export function runeGlyphMotionFor(rune,{ceremony=false}={}){
  const id=Number(rune?.rune_id);
  const preset=RUNE_GLYPH_MOTION_PRESETS[id];
  if(!preset)return {style:'none',frames:{
    x:zero,y:zero,rotate:zero,scale:unit,
    opacity:ceremony?[0,.7,1,1,1,1,1]:[0,.7,1,1,1,.76,0]
  }};
  const o=preset.opacity||[0,.72,1,1,1,1,1];
  const kinetic=RUNE_KINETIC_TIMING[preset.weight]||RUNE_KINETIC_TIMING.measured;
  return {style:preset.name,weight:preset.weight,times:kinetic.times,ease:kinetic.ease,durationFactor:kinetic.durationFactor,frames:{
    x:preset.x||zero,
    y:preset.y||zero,
    rotate:preset.rotate||zero,
    scale:preset.scale||unit,
    opacity:ceremony?[...o.slice(0,6),1]:[...o.slice(0,5),o[5]*.76,0]
  }};
}
