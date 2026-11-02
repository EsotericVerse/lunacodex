// Scoped Galaxy article feature switches. Distinct from Scope-level `loc.able`.
// Eight independent booleans are the only article feature switches.
export const GALAXY_ABLE_KEYS=Object.freeze([
  'statics','culture','search','trace','list','keywords','game','extract'
]);
export function legacyGalaxyAble(row={}){
  // Compatibility for imported archives; only `able` is persisted.
  const searchable=row.searchable!==false;
  const statistics=row.statistics_able!==false;
  return {statics:statistics,culture:statistics,search:searchable,trace:searchable&&statistics,
    list:searchable,keywords:searchable&&statistics,game:true,extract:true};
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
// Partial edits must provide the current eight-key `able` value whenever
// any independent switch changes; metadata-only edits leave it untouched.
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table))return values;
  const {searchable,statistics_able,...fields}=values||{};
  return {...fields,...(Object.hasOwn(fields,'able')?{able:galaxyAble(values)}:{})};
}
