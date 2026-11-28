import {PUBLISHED_SCOPE_TABLE_SETTINGS}
  from './published-scope-table-settings.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const TABLE=/^[a-z][a-z0-9_]*$/;

export const DEFAULT_SCOPE_TABLE_SETTINGS=PUBLISHED_SCOPE_TABLE_SETTINGS;

/** Build a physical Scope relation from the published api.manage table suffix.
 * This is a JS snapshot contract: callers supply resident settings; this helper
 * never reads api.manage or issues SQL. */
export function scopeTableName(scopeId,kind,
  settings=DEFAULT_SCOPE_TABLE_SETTINGS[String(scopeId||'').trim().toLowerCase()]||{}){
  const scope=String(scopeId||'').trim().toLowerCase();
  if(!SCOPE.test(scope)||!['galaxy','lucus'].includes(kind))
    throw new TypeError('Invalid LOC Scope table selector');
  const column=kind+'_table';
  const suffix=String(settings?.[column]||kind).trim();
  if(!TABLE.test(suffix))throw new TypeError('Invalid LOC '+kind+' table suffix');
  return scope+'_'+suffix;
}

export function scopeRelationName(scopeId,kind,namespace='silver',settings){
  const table=scopeTableName(scopeId,kind,settings);
  const schema=String(namespace||'').trim();
  if(!schema)return table;
  if(!/^[a-z_][a-z0-9_]{0,62}$/i.test(schema))
    throw new TypeError('Invalid LOC relation namespace');
  return schema+'.'+table;
}

/** Confirm that a published Registry row matches the deployed JS snapshot. */
export function scopeTableSettingsMatch(scopeId,kind,settings){
  try{
    return scopeTableName(scopeId,kind,settings)===scopeTableName(scopeId,kind);
  }catch{return false;}
}

export function scopeTableDescriptor(tableName,
  settingsMap=DEFAULT_SCOPE_TABLE_SETTINGS){
  const table=String(tableName||'').trim().toLowerCase();
  if(!TABLE.test(table))return null;
  for(const [scope,settings] of Object.entries(settingsMap||{})){
    if(!SCOPE.test(scope))continue;
    for(const kind of ['galaxy','lucus']){
      if(table===scopeTableName(scope,kind,settings))
        return Object.freeze({scope,kind});
    }
  }
  return null;
}

// Fixed LOC-wide tables are derived from the same published suffix map as
// ordinary Scope relations. Callers use these values instead of repeating
// `loc_lucus` or assembling a qualified name by hand.
export const LOC_LUCUS_TABLE=scopeTableName('loc','lucus');
export const LOC_LUCUS_RELATION=scopeRelationName('loc','lucus');

export function scopeTableSettingsFromRows(rows=[]){
  const result={};
  for(const row of Array.isArray(rows)?rows:[]){
    const scope=String(row?.id||row?.scope_id||'').trim().toLowerCase();
    if(!SCOPE.test(scope))continue;
    const settings={};
    for(const kind of ['galaxy','lucus']){
      const value=String(row?.[kind+'_table']||kind).trim();
      if(!TABLE.test(value))throw new TypeError('Invalid LOC '+kind+' table suffix');
      settings[kind+'_table']=value;
    }
    result[scope]=Object.freeze(settings);
  }
  return Object.freeze(result);
}
