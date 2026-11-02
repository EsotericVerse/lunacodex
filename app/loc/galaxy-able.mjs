// Scoped Galaxy article feature switches. Distinct from Scope-level `loc.able`.
// Eight independent booleans are the only article feature switches.
export const GALAXY_ABLE_KEYS=Object.freeze([
  'statics','culture','search','trace','list','keywords','game','extract'
]);
export function legacyGalaxyAble(){
  return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>[key,true]));
}
export function galaxyAble(row={}){
  const legacy=legacyGalaxyAble(row);
  const existing=row.able;
  if(!existing||typeof existing!=='object'||Array.isArray(existing))return legacy;
  return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>[
    key,typeof existing[key]==='boolean'?existing[key]:legacy[key]
  ]));
}
export function isScopedGalaxy(table){
  return /^silver\.[a-z][a-z0-9]{0,14}_galaxy$/.test(String(table||''));
}
export function prepareGalaxyInsertRows(table,rows=[]){
  if(!isScopedGalaxy(table))return rows;
  return rows.map(row=>{const {searchable,statistics_able,...fields}=row;return {...fields,able:galaxyAble(row)};});
}
// Never replace an existing article's six independent toggles with defaults
// during a partial metadata UPDATE. Callers must supply the current `able`
// when editing that field; legacy columns are retained until this is complete.
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table))return values;
  const {searchable,statistics_able,...fields}=values||{};
  return {...fields,...(Object.hasOwn(fields,'able')?{able:galaxyAble(values)}:{})};
}
