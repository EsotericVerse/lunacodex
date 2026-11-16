/** LOC Web publishes LOC-owned assets; LRS owns all Rune art and effects.
 * The existing LOC IPA has a separate, explicit native asset handoff.
 */
export const LRS_PICTURE_NAMES=new Set([
 '01.soul.jpg','01.soul_s.jpg','02_connection.jpg','02_connection_s.jpg',
 '03_life.jpg','03_life_s.jpg','04_nature.jpg','04_nature_s.jpg',
 '05_mineral.jpg','05_mineral_s.jpg','06_element.jpg','06_element_s.jpg',
 '07_order.jpg','07_order_s.jpg','08_disorder.jpg','08_disorder_s.jpg',
 '09_specia.jpg','09_special_s.jpg',
 'LunaRunes-hero.jpg','LunaRunes-hero_s.webp','LunaRunes.webp',
 'LunaRunesGame.jpg','lrunes66_overview.jpg','lrunes66_overview_s.jpg'
]);
export function isLrsWebAsset(rel){
 const normalized=String(rel||'').replaceAll('\\','/').replace(/^\/+|\/+$/g,'');
 return normalized==='assets/lunarunes'||normalized.startsWith('assets/lunarunes/')||
   normalized==='assets/site/icons/lrunes-favicon.png'||
   (normalized.startsWith('assets/pics/')&&LRS_PICTURE_NAMES.has(normalized.slice('assets/pics/'.length)))||
   (normalized.startsWith('pics/')&&LRS_PICTURE_NAMES.has(normalized.slice('pics/'.length)))||
   normalized==='vendor/effekseer'||normalized.startsWith('vendor/effekseer/')||
   normalized==='vendor/rune-semantic-icons'||normalized.startsWith('vendor/rune-semantic-icons/')||
   normalized==='LunarRunesCardCut.pdf';
}
export function allowStaticSource(rel,{native=false}={}){
 return native||!isLrsWebAsset(rel);
}
