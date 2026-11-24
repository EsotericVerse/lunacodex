import {spaceCoordinates} from './space-graph.mjs';
// Review candidates require identical complete name characters (including repeats)
// and the exact same recorded coordinates and Scope. No fuzzy token matching.
const BRANDS=['worldgym','家樂福'];
const CITY_PREFIXES=['新北市','新北','臺北市','台北市','台北','桃園市','台中市','臺中市','台南市','臺南市','高雄市'];
export function compactPlaceName(value){
  return String(value||'').normalize('NFKC').toLowerCase().replace(/臺/g,'台')
    .replace(/[\s\u3000\u200b·•．.，,、;；:：()（）\[\]【】「」『』／\/\\_\-]+/gu,'');
}
export function placeNameKey(value){
  const compact=compactPlaceName(value);
  if(!compact)return '';
  for(const brand of BRANDS){
    const at=compact.indexOf(brand);
    if(at<0)continue;
    let branch=compact.slice(0,at)+compact.slice(at+brand.length);
    for(const city of CITY_PREFIXES){
      if(branch.startsWith(city)){branch=branch.slice(city.length);break;}
    }
    branch=branch.replace(/店$/u,'');
    if(branch.length>=2)return brand+':'+branch;
  }
  return compact;
}
// Read-only, O(n) exact-position candidate grouping. An identical GPS fix is
// evidence for review, never permission to delete a UID or merge article links.
export function exactNameCharacters(value){
  return [...String(value||'').normalize('NFKC').toLowerCase().replace(/臺/g,'台')
    .replace(/[\p{P}\p{S}\p{Z}\s\u200b]/gu,'')].sort().join('');
}
export function reviewReorderedCoordinateNames(anchors=[]){
  const byKey=new Map();
  for(const anchor of anchors){
    if(anchor?.trace_type!=='space_anchor')continue;
    const position=spaceCoordinates(anchor);
    const characters=exactNameCharacters(anchor.title);
    if(!position||characters.length<2)continue;
    const scope=String(anchor.source_scope||'');
    const key=JSON.stringify([scope,position,characters]);
    if(!byKey.has(key))byKey.set(key,{key,position,items:[]});
    byKey.get(key).items.push(anchor);
  }
  return [...byKey.values()].filter(group=>group.items.length>1&&
    new Set(group.items.map(row=>String(row.title||''))).size>1)
    .map(group=>({...group,items:group.items.sort((a,b)=>
      String(a.createtime||a.created_at||'').localeCompare(String(b.createtime||b.created_at||'')))}))
    .sort((a,b)=>b.items.length-a.items.length||a.key.localeCompare(b.key));
}

function sameRecordedPosition(a,b){
  const first=spaceCoordinates(a),second=spaceCoordinates(b);
  return Boolean(first&&second&&first[0]===second[0]&&first[1]===second[1]);
}
export function samePlaceFloor(a,b){
  const x=String(a?.floor_label||'').trim().toLowerCase();
  const y=String(b?.floor_label||'').trim().toLowerCase();
  const n=a?.floor_level??null,m=b?.floor_level??null;
  // A missing floor on one side is NOT proof that both are the same floor.
  return x===y&&(n===null&&m===null||(n!==null&&m!==null&&Number(n)===Number(m)));
}
export function initialPlaceOf(group){
  return [...group].sort((a,b)=>
    String(a.createtime||a.created_at||'').localeCompare(String(b.createtime||b.created_at||'')))[0];
}
function tokens(value){
  const s=compactPlaceName(value).replace(/店$/u,'');
  return new Set([...s.matchAll(/[\p{Script=Han}]{2}|[a-z]{3,}/gu)].map(m=>m[0]));
}
export function uncertainPlaceName(a,b){
  const x=compactPlaceName(a),y=compactPlaceName(b);
  if(!x||!y||x===y||x.length<3||y.length<3)return false;
  if(x.length>=4&&y.length>=4&&(x.includes(y)||y.includes(x)))return true;
  const ta=tokens(a),tb=tokens(b);
  let shared=0;
  for(const token of ta)if(tb.has(token))shared++;
  return shared>=2&&shared/Math.max(ta.size,tb.size)>=0.38;
}
export function reviewPlaceNameGroups(anchors=[]){
  const byKey=new Map();
  for(const anchor of anchors){
    if(anchor?.trace_type!=='space_anchor')continue;
    const coordinates=spaceCoordinates(anchor);
    const characters=exactNameCharacters(anchor.title);
    if(!coordinates||!characters)continue;
    const key=JSON.stringify([String(anchor.source_scope||''),coordinates,characters]);
    if(!byKey.has(key))byKey.set(key,[]);
    byKey.get(key).push(anchor);
  }
  const automatic=[],uncertain=[];
  for(const [key,rows] of byKey){
    if(rows.length<2||new Set(rows.map(row=>String(row.title||''))).size<2)continue;
    const ordered=[...rows].sort((a,b)=>
      String(a.createtime||a.created_at||'').localeCompare(String(b.createtime||b.created_at||'')));
    const group={key,canonical:ordered[0],items:ordered,
      reason:'同座標、完整名稱字元相同'};
    if(ordered.every(row=>samePlaceFloor(ordered[0],row)))automatic.push(group);
    else uncertain.push({...group,reason:'名稱字元與座標相同，但樓層不同，請確認'});
  }
  return {automatic:automatic.sort((a,b)=>b.items.length-a.items.length),
    uncertain:uncertain.sort((a,b)=>b.items.length-a.items.length)};
}
