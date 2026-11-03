// Galaxy article visibility flags are independent boolean columns.
// Scope-level loc.able is a separate configuration field and is untouched.
export const GALAXY_ABLE_KEYS=Object.freeze([
  'statics','culture','search','trace','list','keyword','others','extract'
]);
export const GALAXY_ABLE_COLUMNS=GALAXY_ABLE_KEYS.join(',');

const legacyKey=key=>key==='keyword'?'keywords':key==='others'?'game':key;
const enabled=value=>value===true||value===1||value==='true'||value==='1';

export function legacyGalaxyAble(row={}){
  const searchable=row.searchable!==false;
  const statistics=row.statistics_able!==false;
  return {statics:statistics,culture:statistics,search:searchable,trace:searchable&&statistics,
    list:searchable,keyword:searchable&&statistics,others:true,extract:true};
}
// Convert an imported legacy record to the current eight-key shape; direct
// boolean columns always win over the deprecated able object.
export function galaxyAble(row={}){
  const fallback=legacyGalaxyAble(row);
  const legacy=row.able&&typeof row.able==='object'&&!Array.isArray(row.able)?row.able:{};
  return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>{
    const direct=row[key],old=legacy[key]??legacy[legacyKey(key)];
    return [key,typeof direct==='boolean'?direct:typeof old==='boolean'?old:
      (direct===0||direct===1)?enabled(direct):fallback[key]];
  }));
}
export function isScopedGalaxy(table){
  return /^silver\.[a-z][a-z0-9]{0,14}_galaxy$/.test(String(table||''));
}
const localGalaxy=table=>String(table)==='silver.local_galaxy';
function toColumnFields(row){
  const flags=galaxyAble(row);
  const {able,searchable,statistics_able,game,keywords,...fields}=row||{};
  return {...fields,...flags};
}
function toLocalFields(row){
  const flags=galaxyAble(row);
  const {keyword,others,...rest}=flags;
  const {able,searchable,statistics_able,...fields}=row||{};
  return {...fields,able:{...rest,keywords:keyword,game:others}};
}
export function prepareGalaxyInsertRows(table,rows=[]){
  if(!isScopedGalaxy(table))return rows;
  return rows.map(localGalaxy(table)?toLocalFields:toColumnFields);
}
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table))return values;
  const fields=values||{};
  const hasFlags=Object.hasOwn(fields,'able')||GALAXY_ABLE_KEYS.some(key=>Object.hasOwn(fields,key))||
    Object.hasOwn(fields,'keywords')||Object.hasOwn(fields,'game');
  if(!hasFlags)return fields;
  if(localGalaxy(table))return toLocalFields(fields);
  const {able,game,keywords,...rest}=fields;
  if(!Object.hasOwn(fields,'able')){
    // Older edit payloads may still use the two retired names.
    // Never reset unrelated flags during a partial update.
    if(!Object.hasOwn(rest,'keyword')&&Object.hasOwn(fields,'keywords'))rest.keyword=enabled(keywords);
    if(!Object.hasOwn(rest,'others')&&Object.hasOwn(fields,'game'))rest.others=enabled(game);
    return rest;
  }
  return {...rest,...galaxyAble(fields)};
}
