// A single model-column contract for LOC's trusted Kysely SQL fallback.
// ZenStack's existing SchemaDef remains authoritative for modeled fields;
// unknown external tables keep their existing Kysely/dialect handling.
import {schema} from './schema.mjs';

const named=new Map();
for(const model of Object.values(schema.models)){
  const attr=name=>model.attributes?.find(item=>item.name===name)
    ?.args?.[0]?.value?.value;
  const namespace=attr('@@schema'),table=attr('@@map');
  if(namespace&&table)named.set(namespace+'.'+table,model.fields);
}
const scoped=/^([a-z][a-z0-9]{0,14})_(galaxy|anchor|blocks)$/;
const kinds={galaxy:'Lo3rwangGalaxy',anchor:'Lo3rwangAnchor',blocks:'Lo3rwangBlocks'};

export function modelFieldsForSql(schemaName,tableName){
  const exact=named.get(String(schemaName)+'.'+String(tableName));
  if(exact)return exact;
  const match=String(schemaName)==='silver'?scoped.exec(String(tableName||'')):null;
  return match?schema.models[kinds[match[2]]]?.fields||null:null;
}

// This is column-name contract validation, not permission verification or
// runtime type-difference handling. Normal SQL values stay on Kysely;
// LOC Auth and the trusted application boundary retain access control.
export function verifyModeledSqlFields({schema:namespace,table,columns=[],
  filters=[],orders=[],values=null,onConflict=[]}={}){
  const fields=modelFieldsForSql(namespace,table);
  if(!fields)return false;
  const requested=[
    ...columns.filter(name=>name!=='*'),
    ...filters.map(item=>item.column),
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
  const fields=modelFieldsForSql(namespace,table);
  if(!fields)return rows;
  const boolColumns=Object.entries(fields)
    .filter(([,field])=>field.type==='Boolean'&&!field.array)
    .map(([name])=>name);
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
