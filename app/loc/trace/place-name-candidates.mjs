import {compileKeywordLiteralMatcher} from '../keywords/literal-matcher.mjs';

// Read-only place-name candidate discovery. A substring is evidence for review,
// never proof of Point identity or permission to replace a saved place_id.
export function placeCandidateKey(value){
  return String(value??'').normalize('NFKC').toLocaleLowerCase('und')
    .replace(/臺/g,'台').replace(/[\p{P}\p{S}\p{Z}\s\u200b]/gu,'');
}
const usable=value=>[...value].length>=3;

function namesOf(place){
  const location=place?.aliases??place?.attr?.location;
  const aliases=Array.isArray(location)?location:typeof location==='string'?[location]:[];
  return [place?.title,...aliases].filter(value=>typeof value==='string'&&value.trim());
}

// Both directions are needed: "台北車站" may appear inside a stored longer
// name, while a longer incoming name may contain a stored shorter alias.
// Compile the two dictionaries ONCE per batch, not once for every name pair.
export function matchPlaceNameCandidates(incoming=[],known=[],{maxCandidates=8}={}){
  const sourceNames=new Map(),sourcesByName=new Map();
  for(const item of incoming){
    const id=String(item?.key??'');
    const name=placeCandidateKey(item?.name);
    if(!id||!usable(name)||sourceNames.has(id))continue;
    sourceNames.set(id,name);
    if(!sourcesByName.has(name))sourcesByName.set(name,new Set());
    sourcesByName.get(name).add(id);
  }
  const targets=new Map(),uidsByName=new Map();
  for(const place of known){
    const uid=String(place?.uid??'');
    if(!uid||targets.has(uid))continue;
    targets.set(uid,{uid,title:String(place?.title||'')});
    for(const raw of namesOf(place)){
      const name=placeCandidateKey(raw);
      if(!usable(name))continue;
      if(!uidsByName.has(name))uidsByName.set(name,new Set());
      uidsByName.get(name).add(uid);
    }
  }
  if(!sourceNames.size||!uidsByName.size)return new Map();
  const knownMatcher=compileKeywordLiteralMatcher([...uidsByName.keys()]);
  const incomingMatcher=compileKeywordLiteralMatcher([...sourcesByName.keys()]);
  const found=new Map();
  const add=(sourceId,uid,matchedName)=>{
    const name=sourceNames.get(sourceId),target=targets.get(uid);
    if(!name||!target)return;
    if(!found.has(sourceId))found.set(sourceId,new Map());
    const matches=found.get(sourceId);
    const length=[...matchedName].length;
    const previous=matches.get(uid);
    if(!previous||length>previous.score)
      matches.set(uid,{...target,matchedName,score:length});
  };
  for(const [id,name] of sourceNames){
    for(const [matchedName] of knownMatcher.countMatches(name))
      for(const uid of uidsByName.get(matchedName)||[])add(id,uid,matchedName);
  }
  for(const [knownName,uids] of uidsByName){
    for(const [sourceName] of incomingMatcher.countMatches(knownName))
      for(const id of sourcesByName.get(sourceName)||[])
        for(const uid of uids)add(id,uid,sourceName);
  }
  const result=new Map();
  const limit=Math.max(1,Math.floor(Number(maxCandidates)||8));
  for(const [id,candidates] of found){
    result.set(id,[...candidates.values()]
      .sort((a,b)=>b.score-a.score||a.uid.localeCompare(b.uid))
      .slice(0,limit).map(({score,...candidate})=>candidate));
  }
  return result;
}
