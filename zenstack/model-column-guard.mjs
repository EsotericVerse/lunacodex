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
// runtime value coercion. ZenStack ORM performs its own model-input checks;
// LOC Auth and the trusted SQL Gateway remain responsible for access control.
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
