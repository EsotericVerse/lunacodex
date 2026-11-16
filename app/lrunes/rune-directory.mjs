import {runeAssetHref} from './rune-asset-origin.mjs';

// Web reads the LRS release origin; the LOC IPA uses bundled real files.
const GROUP_IMAGE_BY_ID=Object.freeze({
  '01':runeAssetHref('/pics/01.soul.jpg'),'02':runeAssetHref('/pics/02_connection.jpg'),'03':runeAssetHref('/pics/03_life.jpg'),
  '04':runeAssetHref('/pics/04_nature.jpg'),'05':runeAssetHref('/pics/05_mineral.jpg'),'06':runeAssetHref('/pics/06_element.jpg'),
  '07':runeAssetHref('/pics/07_order.jpg'),'08':runeAssetHref('/pics/08_disorder.jpg'),'09':runeAssetHref('/pics/09_specia.jpg')
});

export function groupImage(id){return GROUP_IMAGE_BY_ID[String(id).padStart(2,'0')]||'';}
// The 3D sanctuary uses the published full-resolution group art, not small
// list thumbnails. Rendering quality must not depend on stretched previews.
export function groupPreviewImage(id){return groupImage(id);}

// Official 月之符文 identity, not the LOC app emblem nor Rune 50 artwork.
export const RUNE_CARD_BACK_IMAGE=runeAssetHref('/assets/site/icons/lrunes-favicon.png');

export function runeName(card){return String(card?.rune_name||'').replace(/之符文$/,'').trim();}
// Rune ID is the only canonical image identity on both Web and iOS.
export function runeImage(card){
  const id=Number(card?.rune_id??card?.id??card?.rune_number);
  if(!Number.isInteger(id)||id<0||id>66)return '';
  return runeAssetHref(`/assets/lunarunes/cards/${String(id).padStart(2,'0')}.png`);
}
export function runeNumbersForGroup(groupId){
  const id=Number(groupId);
  if(!Number.isInteger(id)||id<1||id>9)return [];
  if(id===9)return [0,65,66];
  const start=(id-1)*8+1;
  return Array.from({length:8},(_,index)=>start+index);
}
export function runeNumberForRoute(groupId,runeId){
  const group=Number(groupId),local=Number(runeId);
  if(!Number.isInteger(group)||group<1||group>9||!Number.isInteger(local))return null;
  if(group===9)return ({0:0,1:65,2:66})[local]??null;
  if(local<1||local>8)return null;
  return (group-1)*8+local;
}
export function localRuneId(groupId,card){
  if(String(groupId).padStart(2,'0')==='09')return ({0:'00',65:'01',66:'02'})[Number(card?.rune_id)]||null;
  const start=(Number(groupId)-1)*8+1;
  return String(Number(card?.rune_id)-start+1).padStart(2,'0');
}
export function groupParams(){return Array.from({length:9},(_,index)=>({group:String(index+1).padStart(2,'0')}));}
export function runeParams(){
  return groupParams().flatMap(({group})=>group==='09'
    ?['00','01','02'].map(rune=>({group,rune}))
    :Array.from({length:8},(_,index)=>({group,rune:String(index+1).padStart(2,'0')}))
  );
}
