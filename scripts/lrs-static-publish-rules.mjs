/** LOC Web and LOC IPA ship only LOC art; independent LRS games and effects ship from LRS. */
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
export function allowStaticSource(rel){
 return !isLrsWebAsset(rel);
}
