// Cached write-time validation derived from LOC's existing ZenStack SchemaDef.
// No separate hand-maintained Galaxy field schema; no SQL, DDL, auth, driver,
// database introspection, or validation work on ordinary page reads.
import {createSchemaFactory} from '@zenstackhq/zod';
import * as z from 'zod';
import {schema} from './schema.mjs';
import physicalContract from './schema-contract.mjs';
import {modelNameForSql} from './model-column-guard.mjs';

const modelFactory=createSchemaFactory(schema);
const validators=new Map();
const scopedGalaxy=/^silver\.[a-z][a-z0-9]{0,14}_galaxy$/;
const char8Uid=/^[A-Za-z0-9]{8}$/;

// The frozen SQL snapshot is authoritative where ZModel V3 loses a native
// distinction: DATE vs DateTime, and SQL-nullable PostgreSQL arrays.
// Derive these adaptations from column metadata, never from a second field map.
function importModelSchema(modelName){
  if(validators.has(modelName))return validators.get(modelName);
  const model=schema.models[modelName];
  if(!model)throw new TypeError('Unknown LOC import ZModel: '+modelName);
  const mapped=name=>model.attributes?.find(attr=>attr.name===name)
    ?.args?.[0]?.value?.value;
  const table=physicalContract.tables.find(row=>
    row.table===mapped('@@map')&&(row.schema||physicalContract.schema)===mapped('@@schema'));
  if(!table)throw new TypeError('LOC import physical contract missing: '+modelName);
  const base=modelFactory.makeModelSchema(modelName,{optionality:'defaults'});
  const overrides={};
  for(const column of table.columns){
    const field=base.shape[column.name];
    if(!field)continue;
    if(column.format==='bpchar'){
      // The existing fixed CHAR(8) columns are LOC UIDs/references. The
      // runtime SchemaDef retains @db.Char but not its length argument.
      // Reject invalid input before PostgreSQL can pad or truncate it.
      overrides[column.name]=field.refine(value=>value==null||
        (typeof value==='string'&&char8Uid.test(value)),
      {message:'Expected exactly 8 ASCII letters or digits'});
    }else if(column.format==='date'){
      // PostgreSQL DATE accepts YYYY-MM-DD; native ZModel maps it to DateTime.
      overrides[column.name]=z.union([field,z.iso.date()]).nullable().optional();
    }else if(column.format.startsWith('_')&&column.nullable){
      // ZModel V3 does not represent nullable list columns losslessly.
      overrides[column.name]=field.nullable().optional();
    }
  }
  const result=Object.keys(overrides).length?base.safeExtend(overrides):base;
  validators.set(modelName,result);
  return result;
}

// Galaxy import and Block editing reuse the same model-derived schema, without
// a second field map, database introspection, or SQL request.
export function modelWriteSchemaForSqlTable(table){
  const [namespace,tableName,extra]=String(table||'').split('.');
  if(!namespace||!tableName||extra)throw new TypeError('Invalid LOC import table');
  const model=modelNameForSql(namespace,tableName);
  if(!model)throw new TypeError('No LOC import ZModel for '+table);
  return importModelSchema(model);
}
// Keep the established Galaxy import API; this is the same cached Zod model.
export {modelWriteSchemaForSqlTable as importSchemaForSqlTable};

export function assertZModelImportRows(table,rows=[],{onProgress}={}){
  if(!scopedGalaxy.test(String(table||'')))throw new TypeError('Invalid LOC Galaxy import table');
  if(!Array.isArray(rows))throw new TypeError('LOC import batch must be an array');
  const validator=modelWriteSchemaForSqlTable(table);
  for(let index=0;index<rows.length;index++){
    const parsed=validator.safeParse(rows[index]);
    if(parsed.success){
      // A bounded event callback connects model validation to the existing
      // import useSyncExternalStore, without querying or polling the database.
      if(typeof onProgress==='function'&&
         ((index+1)%256===0||index+1===rows.length))
        onProgress({completed:index+1,total:rows.length});
      continue;
    }
    const first=parsed.error.issues[0];
    const field=first?.path?.join('.')||'(record)';
    // No raw imported text is included in diagnostics.
    throw new TypeError('LOC 匯入 ZModel 驗證失敗：第 '+(index+1)+
      ' 筆 '+field+' — '+(first?.message||'invalid value'));
  }
  // Zod is validation only. Preserve original rows, UIDs, source metadata,
  // and write-batch semantics without any implicit transforms.
  return rows;
}
