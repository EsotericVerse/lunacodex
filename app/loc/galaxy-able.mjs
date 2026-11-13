// Canonical eight independent Galaxy permission columns, ordered as in the schema.
// A legacy input payload can be converted when importing an old archive, but
// no database query or write ever references Galaxy.able.
import {galaxyReadColumns} from '../../zenstack/galaxy-read-models.mjs';
export const GALAXY_ABLE_KEYS=Object.freeze(galaxyReadColumns('GalaxyAttr'));
export const GALAXY_ABLE_COLUMNS=GALAXY_ABLE_KEYS.join(',');
const legacyKeys={keyword:'keywords',others:'game'};
function booleanOrUndefined(raw){
  if(typeof raw==='boolean')return raw;
  if(raw===1||raw==='1'||String(raw).toLowerCase()==='true')return true;
  if(raw===0||raw==='0'||String(raw).toLowerCase()==='false')return false;
  return undefined;
}
// New Galaxy records retain the existing publishing defaults. The columns
// themselves are always the eight fields of the frozen GalaxyAttr ZModel.
const DEFAULT_GALAXY_ATTR=Object.freeze(Object.fromEntries(
  GALAXY_ABLE_KEYS.map(key=>[key,true])));
export function privateGalaxySource(row={}){
  const site=String(row.site||'').trim().toLowerCase();
  if(site==='mcp')return true;
  if(site!=='github')return false;
  return /#[0-9]+$/.test(String(row.site_id||''))||
    /(?:^|[^0-9])PR\s*#[0-9]+(?:[^0-9]|$)/i.test(String(row.title||''));
}
export function galaxyAble(row={}){
  // Never publish private source content regardless of incoming article flags.
  if(privateGalaxySource(row))return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>[key,false]));
  return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>[
    key,booleanOrUndefined(row[key])??DEFAULT_GALAXY_ATTR[key]
  ]));
}

export function isScopedGalaxy(table){
  return /^silver\.[a-z][a-z0-9]{0,14}_galaxy$/.test(String(table||''));
}
export function prepareGalaxyInsertRows(table,rows=[]){
  if(!isScopedGalaxy(table))return rows;
  return rows.map(row=>{
    if(['able','searchable','statistics_able','keywords','game']
      .some(key=>Object.hasOwn(row,key)))
      throw new Error('Retired Galaxy fields are not part of the GalaxyAttr ZModel');
    return {...row,...galaxyAble(row)};
  });
}
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table))return values;
  // A partial edit touches only ZModel fields explicitly supplied by the caller.
  if(['able','searchable','statistics_able','keywords','game']
    .some(key=>Object.hasOwn(values||{},key)))
    throw new Error('Retired Galaxy fields are not part of the GalaxyAttr ZModel');
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
