/** LOC Web publishes LOC-owned assets including lrunes Scope hero art; LRS owns draw/game media and effects.
 * The existing LOC IPA has a separate, explicit native asset handoff.
 */
// Homepage Hero and Game editorial artwork are LOC Scope assets, not LRS VFX.
// Preserve their original /pics and /assets/pics locations on LOC Web.
export function isLrsWebAsset(rel){
 const normalized=String(rel||'').replaceAll('\\','/').replace(/^\/+|\/+$/g,'');
 return normalized==='assets/lunarunes'||normalized.startsWith('assets/lunarunes/')||
   normalized==='assets/site/icons/lrunes-favicon.png'||
   normalized==='vendor/effekseer'||normalized.startsWith('vendor/effekseer/')||
   normalized==='vendor/rune-semantic-icons'||normalized.startsWith('vendor/rune-semantic-icons/')||
   normalized==='LunarRunesCardCut.pdf';
}
export function allowStaticSource(rel,{native=false}={}){
 return native||!isLrsWebAsset(rel);
}
