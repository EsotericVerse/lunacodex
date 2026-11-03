// Galaxy article feature permissions use eight independent boolean columns.
// The retired JSONB payload remains accepted only as a legacy import input.
export const GALAXY_ABLE_KEYS=Object.freeze(['statics','culture','search','trace','list','keyword','others','extract']);
const legacyKeys={keyword:'keywords',others:'game'};
export function legacyGalaxyAble(row={}){
  const searchable=row.searchable!==false;
  const statistics=row.statistics_able!==false;
  return {statics:statistics,culture:statistics,search:searchable,trace:searchable&&statistics,
    list:searchable,keyword:searchable&&statistics,others:true,extract:true};
}
export function galaxyAble(row={}){
  const fallback=legacyGalaxyAble(row);
  const packed=row.able&&typeof row.able==='object'&&!Array.isArray(row.able)?row.able:{};
  return Object.fromEntries(GALAXY_ABLE_KEYS.map(key=>{
    const raw=row[key]??packed[key]??packed[legacyKeys[key]];
    return [key,typeof raw==='boolean'?raw:fallback[key]];
  }));
}
export function isScopedGalaxy(table){
  return /^silver\.[a-z][a-z0-9]{0,14}_galaxy$/.test(String(table||''));
}
export function prepareGalaxyInsertRows(table,rows=[]){
  if(!isScopedGalaxy(table))return rows;
  return rows.map(row=>{
    const {able,searchable,statistics_able,keywords,game,...fields}=row;
    return {...fields,...galaxyAble(row)};
  });
}
export function prepareGalaxyUpdateValues(table,values){
  if(!isScopedGalaxy(table))return values;
  const {able,searchable,statistics_able,keywords,game,...fields}=values||{};
  const updated=able&&typeof able==='object'&&!Array.isArray(able)?galaxyAble(values):{};
  if(typeof keywords==='boolean')updated.keyword=keywords;
  if(typeof game==='boolean')updated.others=game;
  return {...fields,...updated};
}
