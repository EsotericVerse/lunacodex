// One ZModel -> Kysely data-mapping contract for Galaxy-Link short imports.
// Same physical Galaxy model is verified on PostgreSQL, MySQL and SQL Server.
// ZenStack V3 has no MSSQL ORM provider: its frozen model metadata is still
// the source of field types/columns, while Kysely compiles vendor SQL.
// Authorization and existing source-level idempotency remain in the caller.
import {modelFieldsForSql,modeledPrimaryKeyColumns}
  from './model-column-guard.mjs';
import {shortImportLookupPlan,shortImportInsertRows} from './short-import-zk.mjs';
import {galaxyReadColumns} from './galaxy-read-models.mjs';
import {portableRelation,getSqlEnginePort}
  from '../app/loc/providers/sql-engine-ports.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const LOOKUP_FIELDS=Object.freeze(['uid','content','site_id']);
const CORE_FIELDS=Object.freeze(['uid','title','content','site','site_id',
  'url','createtime','UpdateTime']);
const IMPORT_FIELDS=Object.freeze([...CORE_FIELDS,...galaxyReadColumns('GalaxyAttr')]);

/**
 * Bind a trusted database target to the existing frozen Galaxy ZModel.
 * This is model metadata only; it neither connects to a database nor grants
 * permissions. SQL dialect compilation and connection stay with Kysely.
 */
export function portableGalaxyImportMapping({scopeId,engine='postgres',namespace}={}){
  if(typeof scopeId!=='string'||!SCOPE.test(scopeId))
    throw new TypeError('Invalid LOC import Scope');
  getSqlEnginePort(engine);
  const schema=namespace===undefined?(engine==='postgres'?'silver':engine==='mssql'?'dbo':''):namespace;
  const physicalTable=scopeId+'_galaxy';
  const table=portableRelation(physicalTable,engine,schema);
  const fields=modelFieldsForSql('silver',physicalTable);
  const pk=modeledPrimaryKeyColumns('silver',physicalTable);
  if(!fields||pk?.length!==1||pk[0]!=='uid')
    throw new TypeError('LOC Galaxy ZModel primary key mapping unavailable');

  for(const key of IMPORT_FIELDS){
    const field=fields[key];
    if(!field||field.array||field.name!==key)
      throw new TypeError('LOC Galaxy ZModel import mapping missing: '+key);
  }
  for(const key of galaxyReadColumns('GalaxyAttr')){
    if(fields[key].type!=='Boolean')
      throw new TypeError('LOC Galaxy ZModel import flag mismatch: '+key);
  }
  for(const key of ['uid','site','site_id','content']){
    if(fields[key].type!=='String')
      throw new TypeError('LOC Galaxy ZModel import string mismatch: '+key);
  }
  for(const key of ['createtime','UpdateTime']){
    if(fields[key].type!=='DateTime')
      throw new TypeError('LOC Galaxy ZModel import datetime mismatch: '+key);
  }

  const insertKeys=new Set(IMPORT_FIELDS);
  const columns=Object.freeze(Object.fromEntries(
    Object.keys(fields).map(key=>[key,fields[key].name])
  ));
  // Convert only model-typed DateTime values. Keep source timestamps, flags,
  // marker text and every UID unchanged; never write generated columns.
  function mapInsert(row){
    if(!row||typeof row!=='object'||Array.isArray(row)||
        Object.keys(row).some(key=>!insertKeys.has(key))||
        IMPORT_FIELDS.some(key=>!Object.hasOwn(row,key)))
      throw new TypeError('LOC Galaxy import row does not match ZModel mapping');
    return Object.fromEntries(IMPORT_FIELDS.map(key=>{
      const value=row[key];
      if(fields[key].type!=='DateTime')return [columns[key],value];
      const date=value instanceof Date?value:new Date(value);
      if(!Number.isFinite(date.getTime()))
        throw new TypeError('Invalid LOC Galaxy import datetime: '+key);
      return [columns[key],date];
    }));
  }
  function mapInserts(rows){
    // The installed Z+K module already verifies the actual ZenStack Scope
    // model and validates the exact payload with Zod. Do not run a second
    // competing schema or change the existing source/UID authorization.
    const checked=shortImportInsertRows({scope:scopeId,engine,namespace:schema,rows});
    return checked.map(mapInsert);
  }
  function lookupPlan(ids){
    // Use the same ZenStack-generated findMany schema as the existing writer.
    const plan=shortImportLookupPlan({scope:scopeId,engine,namespace:schema,ids});
    return {...plan,columns:plan.columns.map(key=>columns[key])};
  }
  return Object.freeze({
    table,scopeId,engine,
    columns,lookup:LOOKUP_FIELDS.map(key=>columns[key]),
    mapInsert,
    mapInserts,
    lookupPlan,
    // Mapped names for SQL predicates and partial append updates.
    uid:columns.uid,content:columns.content,siteId:columns.site_id,
    site:columns.site,updatedAt:columns.UpdateTime
  });
}
