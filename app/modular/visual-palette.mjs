// Presentation only: a semantic hue remains recognizable across every LOC theme.
const HUES=Object.freeze(['#548bc9','#d49345','#319e91','#9870cf','#ca657d','#6aa36a','#bf8051','#5b9eb9']);
export function visualIndex(key){
  let hash=2166136261;
  for(const c of String(key??''))hash=Math.imul(hash^c.codePointAt(0),16777619);
  return (hash>>>0)%HUES.length;
}
export function visualBase(index){
  return HUES[((Math.trunc(Number(index)||0)%HUES.length)+HUES.length)%HUES.length];
}
export function themedDataColor(base){
  return 'color-mix(in srgb, '+base+' 68%, var(--loc-accent))';
}
export const visualColor=index=>themedDataColor(visualBase(index));
export const visualKeyColor=key=>visualColor(visualIndex(key));

function rgb(value){
  const s=String(value||'').trim();
  const hex=s.match(/^#([a-f\d]{6}|[a-f\d]{3})$/i);
  if(hex){
    const h=hex[1].length===3?[...hex[1]].map(c=>c+c).join(''):hex[1];
    return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
  }
  const match=s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*[\d.]+)?\s*\)$/i);
  return match?match.slice(1,4).map(x=>Math.max(0,Math.min(255,Number(x)))):null;
}
// MapLibre and canvas require concrete RGB colors, not CSS color-mix/var().
export function mixVisualRgb(base,theme,weight=.68){
  const a=rgb(base)||[84,139,201],b=rgb(theme)||a;
  const w=Math.max(0,Math.min(1,Number(weight)||0));
  return '#'+a.map((x,i)=>Math.round(x*w+b[i]*(1-w)).toString(16).padStart(2,'0')).join('');
}
export function territoryColors(accent,gold){
  return [mixVisualRgb('#547faf',accent),mixVisualRgb('#349f91',accent),
    mixVisualRgb('#e4a44e',gold),mixVisualRgb('#dc735b',gold),
    mixVisualRgb('#eab64d',gold)];
}
