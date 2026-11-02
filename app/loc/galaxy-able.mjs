// Scoped Galaxy article feature switches. Distinct from Scope-level `loc.able`.
// Legacy columns remain during the two-version migration window.
export const GALAXY_ABLE_KEYS=Object.freeze([
  'statics','culture','search','trace','list','keywords','game','extract'
]);
export function legacyGalaxyAble(row={}){
  const searchable=row.searchable!==false;
  const statistics=row.statistics_able!==false;
  return {
    statics:statistics,
    culture:statistics,
    search:searchable,
    trace:searchable&&statistics,
    list:searchable,
    keywords:searchable&&statistics,
    game:true,
    extract:true
  };
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
  return /^silver\.(?:lo3rwang|lrunes)_galaxy$/.test(String(table||''));
}
export function prepareGalaxyInsertRows(table,rows=[]){
  if(!isScopedGalaxy(table))return rows;
  return rows.map(row=>({...row,able:galaxyAble(row)}));
}
// Never replace an existing article's six independent toggles with defaults
// during a partial metadata UPDATE. Callers must supply the current `able`
// when editing that field; legacy columns are retained until this is complete.
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table)||!Object.hasOwn(values||{},'able'))return values;
  return {...values,able:galaxyAble(values)};
}
