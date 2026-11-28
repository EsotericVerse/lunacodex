import {spaceCoordinates} from './space-graph.mjs';
// Pure, read-only grouping rules for the Trace organizer.
// Address evidence is stronger than geographic proximity; proximity alone never merges.
const REGIONS=Object.freeze(['基隆市','臺北市','新北市','桃園市','新竹市','新竹縣','苗栗縣','臺中市','彰化縣','南投縣','雲林縣','嘉義市','嘉義縣','臺南市','高雄市','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣']);
const TAIWAN_ALIASES=Object.freeze({'台北市':'臺北市','台中市':'臺中市','台南市':'臺南市','台東縣':'臺東縣'});
export function normalizeAnchorAddress(value){
  return String(value||'').trim().replace(/臺/g,'台').replace(/[，,．.。；;\s　]/g,'').toLowerCase();
}
export function anchorAddress(lucus){
  // Prefer the structured field. Legacy approved descriptions still provide
  // evidence until their contents have been individually reviewed.
  if(String(lucus?.postal_address||'').trim())return String(lucus.postal_address).trim();
  const text=typeof lucus?.description==='string'?lucus.description:String(lucus?.description?.text||'');
  return (text.match(/地址[：:]\s*([^。；;\n]+)/)?.[1]||'').trim();
}
export function countyOfAnchor(lucus){
  const title=String(lucus?.title||'');
  const note=typeof lucus?.description==='string'?lucus.description:String(lucus?.description?.text||'');
  const address=anchorAddress(lucus);
  const text=address+' '+title+' '+note;
  const found=text.match(/(基隆市|臺北市|台北市|新北市|桃園市|新竹市|新竹縣|苗栗縣|臺中市|台中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|臺南市|台南市|高雄市|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/);
  if(found)return TAIWAN_ALIASES[found[1]]||found[1];
  // Older lucus descriptions may contain only a district or a familiar station.
  const hints=[
    [/板橋|江子翠|亞東醫院|中和|永和|土城|新莊|三重|福隆|貢寮|輔仁|亞運保齡球館/,'新北市'],
    [/行天宮|臺大醫院|台大醫院/,'臺北市'],
    [/童玩節|冬山河|傳藝/,'宜蘭縣'],
    [/逢甲/,'臺中市'],
    [/臺南車站|台南車站|高鐵臺南|高鐵台南/,'臺南市'],
    [/東方工專|東方技術學院|東方設計/,'高雄市']
  ];
  for(const [pattern,county] of hints){if(pattern.test(title+' '+note))return county;}
  return /(?:國外|海外)/.test(text)?'國外':'待確認縣市';
}
export function groupAnchorsByCounty(anchors){
  const groups=new Map();
  for(const lucus of anchors||[]){
    const county=countyOfAnchor(lucus);
    if(!groups.has(county))groups.set(county,[]);
    groups.get(county).push(lucus);
  }
  const order=x=>REGIONS.indexOf(x)===-1?REGIONS.length:REGIONS.indexOf(x);
  return [...groups].sort(([a],[b])=>order(a)-order(b)||a.localeCompare(b,'zh-Hant'))
    .map(([county,items])=>({county,items:items.sort((a,b)=>String(a.title).localeCompare(String(b.title),'zh-Hant'))}));
}
function distance(a,b){
  const latA=Number(spaceCoordinates(a)?.[1])*Math.PI/180,latB=Number(spaceCoordinates(b)?.[1])*Math.PI/180;
  const lngDiff=(Number(spaceCoordinates(b)?.[0])-Number(spaceCoordinates(a)?.[0]))*Math.PI/180;
  const dLat=latB-latA;
  return Math.round(2*6371008.8*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+
    Math.cos(latA)*Math.cos(latB)*Math.sin(lngDiff/2)**2))));
}
// Shared matching rule for organizer, pre-insert checks and bulk audits.
// radius_m is a search radius, NOT proof that two businesses are identical.
function compareAnchorPair(a,b){
  if(a.source_scope!==b.source_scope)return null;
  const aa=anchorAddress(a),ba=anchorAddress(b);
  const floorConflict=false;
  const match=aa&&ba&&normalizeAnchorAddress(aa)===normalizeAnchorAddress(ba);
  const both=Boolean(aa&&ba);
  const valid=Boolean(spaceCoordinates(a)&&spaceCoordinates(b));
  const meters=valid?distance(a,b):null;
  const nameMatch=String(a.title||'').normalize('NFKC').replace(/\s/g,'').toLowerCase()
    ===String(b.title||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
  let type='';
  if(match)type=floorConflict?'different-floor':meters!==null&&meters>350?'address-coordinate-conflict':'same-address';
  else if(meters!==null&&meters<=80)type=both?'near-different-address':'near-unverified';
  else if(nameMatch)type='same-name-different-location';
  if(!type)return null;
  return {key:[a.uid,b.uid].sort().join(':'),a,b,address:match?aa:'',meters,type,
    canMerge:type==='same-address'||type==='near-unverified',
    // Same building/coordinates/name may represent another floor or an old
    // business. An lucus UID is never automatically folded into another.
    safeReuse:false};
}
export function findAnchorWriteMatches(lucus,existing=[]){
  const incoming={...lucus,uid:'__incoming__',trace_type:'space_anchor'};
  return (Array.isArray(existing)?existing:[])
    .filter(row=>row?.trace_type==='space_anchor')
    .map(row=>compareAnchorPair(incoming,row))
    .filter(Boolean);
}
export function organizeAnchorCandidates(anchors){
  const list=(anchors||[]).filter(a=>a.trace_type==='space_anchor');
  const results=[];
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    const candidate=compareAnchorPair(list[i],list[j]);
    if(candidate)results.push(candidate);
  }
  return results.sort((a,b)=>{
    const priority={'same-address':0,'near-unverified':1,'address-coordinate-conflict':2,'near-different-address':3,'same-name-different-location':4,'different-floor':5};
    return priority[a.type]-priority[b.type]||(a.meters??999999)-(b.meters??999999);
  });
}

// Review candidates, not place identity. O(n) grouping replaces the
// pairwise O(n²) UI for the same recorded GPS position. A shared GPS
// never authorizes a merge: different shops/floors remain separate UIDs.
export function organizeAnchorCoordinateGroups(anchors=[]){
  const byPosition=new Map();
  for(const lucus of anchors){
    if(lucus?.trace_type!=='lucus')continue;
    const lat=lucus.latitude,lng=lucus.longitude;
    if(lat==null||lng==null||String(lat).trim()===''||String(lng).trim()==='')continue;
    if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))continue;
    const scope=String(lucus.source_scope||'');
    const position=Number(lat).toFixed(6)+','+Number(lng).toFixed(6);
    const key=scope+':'+position;
    let group=byPosition.get(key);
    if(!group){group={key,scope,position,anchors:[],uids:new Set()};byPosition.set(key,group);}
    if(!group.uids.has(lucus.uid)){group.anchors.push(lucus);group.uids.add(lucus.uid);}
  }
  return [...byPosition.values()].filter(group=>group.anchors.length>1)
    .map(({uids,...group})=>({...group,anchors:group.anchors.sort((a,b)=>
      String(a.title||'').localeCompare(String(b.title||''),'zh-Hant'))}))
    .sort((a,b)=>b.anchors.length-a.anchors.length||a.key.localeCompare(b.key));
}
