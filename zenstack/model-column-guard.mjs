// A single model-column contract for LOC's trusted Kysely SQL fallback.
// ZenStack's existing SchemaDef remains authoritative for modeled fields;
// unknown external tables keep their existing Kysely/dialect handling.
import {schema} from './schema.mjs';

const named=new Map();
for(const [modelName,model] of Object.entries(schema.models)){
  const attr=name=>model.attributes?.find(item=>item.name===name)
    ?.args?.[0]?.value?.value;
  const namespace=attr('@@schema'),table=attr('@@map');
  if(namespace&&table)named.set(namespace+'.'+table,modelName);
}
// The fixed Registry JOIN is model-driven, not a second physical-table map.
// Kysely still owns execution on the *caller's* trusted transaction/driver:
// no new connection, ORM fetch, SQL query, policy change or foreign key.
function fixedModelRelation(name){
  const model=schema.models[name];
  const attribute=key=>model?.attributes?.find(item=>item.name===key)
    ?.args?.[0]?.value?.value;
  const namespace=attribute('@@schema'),table=attribute('@@map');
  if(!namespace||!table||model?.idFields?.length!==1)
    throw new Error('LOC Registry ZModel relation contract missing: '+name);
  const id=model.idFields[0];
  if(!model.fields[id])throw new Error('LOC Registry ZModel key missing: '+name);
  return Object.freeze({table:namespace+'.'+table,id,type:model.fields[id].type});
}
const registryModel=fixedModelRelation('Manage');
const locModel=fixedModelRelation('Loc');
if(registryModel.type!==locModel.type)
  throw new Error('Incompatible LOC Registry ZModel JOIN key types');

/** Keeps Registry and LOC directory JOINs mapped by ZModel inside the existing
 * Kysely transaction. A LEFT JOIN retains Registry rows without LOC config.
 */
export function zmodelRegistryJoin(db,{optionalLoc=false}={}){
  const source=db.selectFrom(registryModel.table+' as m');
  const joined=locModel.table+' as l';
  const left='l.'+locModel.id,right='m.'+registryModel.id;
  return optionalLoc?source.leftJoin(joined,left,right):
    source.innerJoin(joined,left,right);
}

const scoped=/^([a-z][a-z0-9]{0,14})_(galaxy|anchor|blocks)$/;
const kinds={galaxy:'Lo3rwangGalaxy',anchor:'Lo3rwangAnchor',blocks:'Lo3rwangBlocks'};

// Share the identical model resolution with import-time Zod validation.
// This is metadata only; neither a driver nor a new SQL lookup is created.
export function modelNameForSql(schemaName,tableName){
  const exact=named.get(String(schemaName)+'.'+String(tableName));
  if(exact)return exact;
  const match=String(schemaName)==='silver'?scoped.exec(String(tableName||'')):null;
  return match?kinds[match[2]]||null:null;
}
export function modelFieldsForSql(schemaName,tableName){
  const modelName=modelNameForSql(schemaName,tableName);
  return modelName?schema.models[modelName]?.fields||null:null;
}

// The Scope relation is logical, not a physical FK or a ZenStack @relation.
// The source must be a *grouped* Galaxy subquery named g, so joining one
// Point cannot multiply article rows or expose a hidden Point. All identifiers
// and join keys are verified against the existing frozen ZModel.
export function zmodelGalaxyPointJoin(source,{scopeId}={}){
  if(typeof scopeId!=='string'||!/^[a-z][a-z0-9]{0,14}$/.test(scopeId))
    throw new TypeError('Invalid LOC Galaxy/Point JOIN Scope');
  const galaxy=modelFieldsForSql('silver',scopeId+'_galaxy');
  const anchor=modelFieldsForSql('silver',scopeId+'_anchor');
  const valid=(field,type)=>field?.type===type&&!field.array;
  if(!valid(galaxy?.place_id,'String')||!valid(anchor?.uid,'String')||
     !valid(anchor?.type,'String')||!valid(anchor?.invisible,'Boolean')||
     !valid(anchor?.title,'String')||!valid(anchor?.attr,'Json'))
    throw new TypeError('LOC Galaxy/Point ZModel JOIN contract missing');
  return source.leftJoin('silver.'+scopeId+'_anchor as a',join=>
    join.onRef('a.uid','=','g.place_id')
      .on('a.type','=','point').on('a.invisible','=',false));
}

/** Physical PKs are defined by the same fixed/dynamic ZModel used for SQL
 * field validation and import. Return a copy to keep schema metadata immutable.
 * Unmodeled external tables continue under their existing dialect contract.
 */
export function modeledPrimaryKeyColumns(schemaName,tableName){
  const modelName=modelNameForSql(schemaName,tableName);
  const ids=modelName?schema.models[modelName]?.idFields:null;
  return ids?.length?[...ids]:null;
}
// SQL Boolean selections and scoped flag mutations share the frozen model.
// This returns field metadata only, never grants write access or issues SQL.
export function modeledBooleanColumns(schemaName,tableName){
  const fields=modelFieldsForSql(schemaName,tableName);
  return fields?Object.entries(fields).filter(([,field])=>
    field.type==='Boolean'&&!field.array).map(([name])=>name):[];
}

// This is column-name contract validation, not permission verification or
// runtime type-difference handling. Normal SQL values stay on Kysely;
// LOC Auth and the trusted application boundary retain access control.
// A parsed, bounded portable OR expression may contain nested AND/OR groups.
// Model the physical predicates as well as the top-level SELECT/WHERE/ORDER BY
// columns, rather than making each Kysely entry point maintain a second list.
// The parser owns grammar/depth/size validation; this only checks ZModel fields.
function modeledPredicateColumns(nodes){
  const columns=[];
  const visit=node=>{
    if(!node||typeof node!=='object')
      throw new TypeError('Invalid LOC ZModel SQL predicate');
    if(node.type==='and'||node.type==='or'){
      if(!Array.isArray(node.items))
        throw new TypeError('Invalid LOC ZModel SQL predicate group');
      for(const item of node.items)visit(item);
    }else if(node.type==='predicate'){
      columns.push(node.column);
    }else{
      throw new TypeError('Invalid LOC ZModel SQL predicate type');
    }
  };
  for(const node of nodes)visit(node);
  return columns;
}
export function verifyModeledSqlFields({schema:namespace,table,columns=[],
  filters=[],orFilters=[],orders=[],values=null,onConflict=[]}={}){
  const fields=modelFieldsForSql(namespace,table);
  if(!fields)return false;
  const requested=[
    ...columns.filter(name=>name!=='*'),
    ...filters.map(item=>item.column),
    ...modeledPredicateColumns(orFilters),
    ...orders.map(item=>item.column),
    ...onConflict,
    ...(Array.isArray(values)?values.flatMap(row=>Object.keys(row||{})):
      values&&typeof values==='object'?Object.keys(values):[])
  ];
  for(const column of requested)
    if(typeof column!=='string'||!Object.hasOwn(fields,column))
      throw new TypeError('Column is not defined in the LOC ZModel: '+String(column));
  return true;
}


// Only differences with a known ZModel type are normalized. Ordinary text,
// numbers, DATE values, JSON and arrays pass unchanged to the SQL driver.
// This is needed for *raw Kysely* statements: ZenStack ORM's automatic
// decoding does not automatically run on Kysely's direct query results.
function modelBoolean(value){
  if(value===true||value===false||value===null)return value;
  if(value===1||value==='1'||value==='true')return true;
  if(value===0||value==='0'||value==='false')return false;
  return value;
}
function normalizedPredicate(node,fields){
  if(!node||typeof node!=='object')return node;
  if((node.type==='and'||node.type==='or')&&Array.isArray(node.items)){
    const items=node.items.map(item=>normalizedPredicate(item,fields));
    return items.every((item,i)=>item===node.items[i])?node:{...node,items};
  }
  if(fields?.[node.column]?.type!=='Boolean'||fields[node.column].array)
    return node;
  const value=Array.isArray(node.value)?node.value.map(modelBoolean):modelBoolean(node.value);
  if(Array.isArray(node.value)){
    if(node.value.every((v,i)=>v===value[i]))return node;
  }else if(value===node.value)return node;
  return {...node,value};
}
/** ZModel-informed exceptional type handling; never routes ordinary SQL. */
export function normalizeModeledTypeDifferences({
  schema:namespace,table,filters=[],orFilters=[]
}={}){
  const fields=modelFieldsForSql(namespace,table);
  if(!fields)return {filters,orFilters};
  return {
    filters:filters.map(node=>normalizedPredicate(node,fields)),
    orFilters:orFilters.map(node=>normalizedPredicate(node,fields))
  };
}
/** Normalize only non-Boolean driver representations of ZModel Boolean columns. */
export function normalizeModeledSelectRows({schema:namespace,table,rows}={}){
  if(!Array.isArray(rows)||!rows.length)return rows;
  const boolColumns=modeledBooleanColumns(namespace,table);
  if(!boolColumns.length)return rows;
  return rows.map(row=>{
    if(!row||typeof row!=='object')return row;
    let normalized=null;
    for(const column of boolColumns){
      if(!Object.hasOwn(row,column))continue;
      const value=modelBoolean(row[column]);
      if(value!==row[column]){
        if(!normalized)normalized={...row};
        normalized[column]=value;
      }
    }
    return normalized||row;
  });
}
