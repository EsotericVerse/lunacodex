// Canonical eight independent Galaxy permission columns, ordered as in the schema.
// A legacy input payload can be converted when importing an old archive, but
// no database query or write ever references Galaxy.able.
// Each feature flag: true = enabled/eligible; false = excluded. Never invert it.
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {scopeTableDescriptor} from '../../../packages/zenstack/scope-table-names.mjs';
export const GALAXY_ABLE_KEYS=Object.freeze(galaxyReadColumns('GalaxyReadLucus'));
export const GALAXY_ABLE_COLUMNS=GALAXY_ABLE_KEYS.join(',');
function booleanOrUndefined(raw){
  if(typeof raw==='boolean')return raw;
  if(raw===1||raw==='1'||String(raw).toLowerCase()==='true')return true;
  if(raw===0||raw==='0'||String(raw).toLowerCase()==='false')return false;
  return undefined;
}
// New Galaxy records retain the existing publishing defaults. The columns
// themselves are always the eight fields of the frozen GalaxyReadLucus ZModel.
const DEFAULT_GALAXY_ATTR=Object.freeze(Object.fromEntries(
  GALAXY_ABLE_KEYS.map(key=>[key,true])));
export function privateGalaxySource(row={}){
  const site=String(row.site||'').trim().toLowerCase();
  if(site!=='github')return false;
  return /#[0-9]+$/.test(String(row.site_id||''))||
    /(?:^|[^0-9])PR\s*#[0-9]+(?:[^0-9]|$)/i.test(String(row.title||''));
}
export function galaxyAble(row={}){
  // GitHub PR records keep their explicitly restricted origin rule.
  if(privateGalaxySource(row))return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>[key,false]));
  const flags=Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>[
    key,booleanOrUndefined(row[key])??DEFAULT_GALAXY_ATTR[key]
  ]));
  // Legacy mcp and private chat From sources remain nonextractable by
  // default; explicitly configured Galaxy flags still take precedence.
  if(['mcp','chatgpt','claude','gemini'].includes(
    String(row.site||'').trim().toLowerCase())&&
    booleanOrUndefined(row.extract)===undefined)flags.extract=false;
  return flags;
}

export function isScopedGalaxy(table){
  return scopeTableDescriptor(String(table||'').split('.').at(-1))?.kind==='galaxy';
}
export function prepareGalaxyInsertRows(table,rows=[]){
  if(!isScopedGalaxy(table))return rows;
  return rows.map(row=>{
    if(['able','searchable','statistics_able','keywords','game']
      .some(key=>Object.hasOwn(row,key)))
      throw new Error('Retired Galaxy fields are not part of the GalaxyReadLucus ZModel');
    return {...row,...galaxyAble(row)};
  });
}
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table))return values;
  // A partial edit touches only ZModel fields explicitly supplied by the caller.
  if(['able','searchable','statistics_able','keywords','game']
    .some(key=>Object.hasOwn(values||{},key)))
    throw new Error('Retired Galaxy fields are not part of the GalaxyReadLucus ZModel');
  const updated={...(values||{})};
  for(const key of GALAXY_ABLE_KEYS){
    if(Object.hasOwn(updated,key)){
      const normalized=booleanOrUndefined(updated[key]);
      if(normalized===undefined)throw new Error('Invalid Galaxy boolean: '+key);
      updated[key]=normalized;
    }
  }
  return updated;
}
