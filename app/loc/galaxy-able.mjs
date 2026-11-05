// Canonical eight independent Galaxy permission columns, ordered as in the schema.
// A legacy input payload can be converted when importing an old archive, but
// no database query or write ever references Galaxy.able.
export const GALAXY_ABLE_KEYS=Object.freeze([
  'statics','culture','search','trace','list','keyword','extract','others'
]);
export const GALAXY_ABLE_COLUMNS=GALAXY_ABLE_KEYS.join(',');
const legacyKeys={keyword:'keywords',others:'game'};
function booleanOrUndefined(raw){
  if(typeof raw==='boolean')return raw;
  if(raw===1||raw==='1'||String(raw).toLowerCase()==='true')return true;
  if(raw===0||raw==='0'||String(raw).toLowerCase()==='false')return false;
  return undefined;
}
export function legacyGalaxyAble(row={}){
  const searchable=booleanOrUndefined(row.searchable)!==false;
  const statistics=booleanOrUndefined(row.statistics_able)!==false;
  return {statics:statistics,culture:statistics,search:searchable,
    trace:searchable&&statistics,list:searchable,keyword:searchable&&statistics,
    extract:true,others:true};
}
export function privateGalaxySource(row={}){
  const site=String(row.site||'').trim().toLowerCase();
  if(site==='mcp')return true;
  if(site!=='github')return false;
  return /#[0-9]+$/.test(String(row.site_id||''))||
    /(?:^|[^0-9])PR\\s*#[0-9]+(?:[^0-9]|$)/i.test(String(row.title||''));
}
export function galaxyAble(row={}){
  // A source labelled MCP or GitHub PR must never inherit an old public flag,
  // even when imported archives explicitly contain legacy `able` values.
  if(privateGalaxySource(row))return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>[key,false]));
  const fallback=legacyGalaxyAble(row);
  // Legacy archive input only. This object is always expanded to columns.
  const packed=row.able&&typeof row.able==='object'&&!Array.isArray(row.able)?row.able:{};
  return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>{
    const direct=booleanOrUndefined(row[key]);
    const imported=booleanOrUndefined(packed[key]??packed[legacyKeys[key]]);
    return [key,direct??imported??fallback[key]];
  }));
}
export function isScopedGalaxy(table){
  return /^silver\.[a-z][a-z0-9]{0,14}_galaxy$/.test(String(table||''));
}
const localGalaxy=table=>String(table)==='silver.local_galaxy';
function toLocalFields(row={}){
  const flags=galaxyAble(row);
  const {keyword,others,...rest}=flags;
  // Device-local SQLite has only the legacy packed permission field.
  // Never pass physical Galaxy booleans through its column adapter.
  const omit=new Set([...GALAXY_ABLE_KEYS,'able','searchable','statistics_able','keywords','game']);
  const fields=Object.fromEntries(Object.entries(row).filter(([key])=>!omit.has(key)));
  return {...fields,able:{...rest,keywords:keyword,game:others}};
}
export function prepareGalaxyInsertRows(table,rows=[]){
  if(!isScopedGalaxy(table))return rows;
  if(localGalaxy(table))return rows.map(toLocalFields);
  return rows.map(row=>{
    const {able,searchable,statistics_able,keywords,game,...fields}=row;
    return {...fields,...galaxyAble(row)};
  });
}
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table))return values;
  if(localGalaxy(table)){
    const fields=values||{};
    const hasFlags=Object.hasOwn(fields,'able')||
      GALAXY_ABLE_KEYS.some(key=>Object.hasOwn(fields,key))||
      Object.hasOwn(fields,'keywords')||Object.hasOwn(fields,'game');
    return hasFlags?toLocalFields(fields):fields;
  }
  const {able,searchable,statistics_able,keywords,game,...fields}=values||{};
  // A partial edit must only touch flags explicitly provided. Never reset
  // other columns or rebuild the old packed "able" payload.
  const updated={...fields};
  if(booleanOrUndefined(keywords)!==undefined&&updated.keyword===undefined)
    updated.keyword=booleanOrUndefined(keywords);
  if(booleanOrUndefined(game)!==undefined&&updated.others===undefined)
    updated.others=booleanOrUndefined(game);
  for(const key of GALAXY_ABLE_KEYS){
    if(Object.hasOwn(updated,key)){
      const normalized=booleanOrUndefined(updated[key]);
      if(normalized===undefined)throw new Error('Invalid Galaxy boolean: '+key);
      updated[key]=normalized;
    }
  }
  return updated;
}
