/** LunaRunes lettering: eight reusable font families across all canonical Rune IDs.
 * Presentation styles never redefine the database's Rune semantics.
 * Rune 0 is included only for author visualization, not the draw pool.
 */
export const RUNE_GLYPH_STYLES=Object.freeze({
"scribe":Object.freeze({"label":"靈思手札","font":"script","ink":"#dbcce8","finish":"ink","ids":[0,1,2,4,13,15,23,24,57]}),
"monument":Object.freeze({"label":"刻銘碑文","font":"serif","ink":"#dec6ac","finish":"stone","ids":[5,6,8,11,12,18,20,29,33,36,37,39,46,49,54,56,64,66]}),
"vigorous":Object.freeze({"label":"奔放筆勢","font":"brush","ink":"#f1b9a0","finish":"ink","ids":[9,10,14,16,40,44,45,47,58,65]}),
"living":Object.freeze({"label":"生長書韻","font":"kai","ink":"#b6d8ae","finish":"ink","ids":[17,25,27,28,30,31,32,43,48]}),
"tender":Object.freeze({"label":"柔韻墨意","font":"soft","ink":"#ead1de","finish":"ink","ids":[3,19,21,22,26,34,60,61,62]}),
"prismatic":Object.freeze({"label":"晶耀字鋒","font":"sharp","ink":"#f7dea6","finish":"glass","ids":[7,35,38,41,50,51,53]}),
"cosmic":Object.freeze({"label":"星域銘文","font":"serif","ink":"#bdcce9","finish":"glass","ids":[42,52,55,63]}),
"blank":Object.freeze({"label":"留白本體","font":"minimal","ink":"#dad8d0","finish":"plain","ids":[59]})
});
const byId=new Map();
for(const [family,style] of Object.entries(RUNE_GLYPH_STYLES)){
  for(const id of style.ids){
    if(byId.has(id))throw Error('Duplicate Rune ID: '+id);
    byId.set(id,family);
  }
}
// Canonical semantic letter colors: 0 is the special author rune; 1–66
// are the drawable runes. The shared font family selects SHAPE only, never
// the meaning's hue. Same token feeds 2D fallback and lit 3D mesh.
export const RUNE_GLYPH_INKS=Object.freeze({
  0: '#decfb8',
  1: '#c6c2ef',
  2: '#d8b8f0',
  3: '#e5c0f2',
  4: '#b8b6d9',
  5: '#aebdce',
  6: '#c3b19b',
  7: '#c7eaf2',
  8: '#eca975',
  9: '#9ad2bb',
  10: '#ef8f9e',
  11: '#c3b8e5',
  12: '#b7bfd0',
  13: '#f1cf89',
  14: '#cbb3e0',
  15: '#f5e4b4',
  16: '#e4a0ad',
  17: '#a7dfb5',
  18: '#b6ab9b',
  19: '#c9a8c0',
  20: '#b4b1c3',
  21: '#ef96ac',
  22: '#f0b4c8',
  23: '#a6c9ed',
  24: '#c7b2ec',
  25: '#9acb9d',
  26: '#edacd0',
  27: '#a6d86c',
  28: '#99d48b',
  29: '#b69370',
  30: '#d2c084',
  31: '#eda071',
  32: '#9cce9e',
  33: '#f4d078',
  34: '#a9e9d0',
  35: '#c1ebff',
  36: '#c9b597',
  37: '#aebdcd',
  38: '#edf5ff',
  39: '#bfb3a6',
  40: '#bbb1a2',
  41: '#ffeb9f',
  42: '#c0aedc',
  43: '#66d0ff',
  44: '#ff985d',
  45: '#a6e4db',
  46: '#cfaa84',
  47: '#c6b5ff',
  48: '#b0eaf2',
  49: '#ffd576',
  50: '#d8dff3',
  51: '#e7edff',
  52: '#bcb6e7',
  53: '#d3f4ff',
  54: '#b8c7e0',
  55: '#afc0f5',
  56: '#bcc7d3',
  57: '#f2dea9',
  58: '#e899a6',
  59: '#dcd9d1',
  60: '#dcc5f2',
  61: '#c9a8eb',
  62: '#c7b7e2',
  63: '#ad9aca',
  64: '#ecc08a',
  65: '#d0a0f4',
  66: '#dac4d1'
});
const fallback=Object.freeze({family:'scribe',font:'script',ink:'#e6d8c9',finish:'ink'});
export function runeGlyphProfile(rune){
  const id=Number(rune?.rune_id);
  const family=Number.isInteger(id)?byId.get(id):null;
  if(!family)return fallback;
  const style=RUNE_GLYPH_STYLES[family];
  return {family,font:style.font,ink:RUNE_GLYPH_INKS[id]||style.ink,finish:style.finish};
}
export const RUNE_GLYPH_IDS=Object.freeze([...byId.keys()].sort((a,b)=>a-b));
