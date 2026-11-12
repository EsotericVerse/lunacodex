// Cached write-time validation derived from LOC's existing ZenStack SchemaDef.
// No separate hand-maintained Galaxy field schema; no SQL, DDL, auth, driver,
// database introspection, or validation work on ordinary page reads.
import {createSchemaFactory} from '@zenstackhq/zod';
import * as z from 'zod';
import {schema} from './schema.mjs';
import physicalContract from './schema-contract.mjs';
import {modelNameForSql} from './model-column-guard.mjs';
import {ANCHOR_GROUP_MODEL_NAMES,ANCHOR_TYPE_GROUP_FIELDS,ANCHOR_TYPE_GROUPS,
  PERSISTED_ANCHOR_TYPES}
  from './anchor-hierarchy.mjs';

const modelFactory=createSchemaFactory(schema);
const validators=new Map();
const scopedGalaxy=/^silver\.[a-z][a-z0-9]{0,14}_galaxy$/;
const char8Uid=/^[A-Za-z0-9]{8}$/;
// Anchor.attr validation is derived from the same ZModel value types that
// describe the semantic discriminator. Pattern is the one intentional
// exception: its stored JSON object is a dynamic database-UID posting map,
// so it is wrapped in the PatternAnchor.postings Json field for validation.
const anchorTypeGroups=Object.fromEntries(Object.entries(ANCHOR_TYPE_GROUPS)
  .flatMap(([group,types])=>types.map(type=>[type,group])));
const anchorPayloadValidators=new Map(PERSISTED_ANCHOR_TYPES.map(type=>{
  const group=anchorTypeGroups[type];
  if(!group||!ANCHOR_TYPE_GROUP_FIELDS[type]||!ANCHOR_GROUP_MODEL_NAMES[group])
    throw new Error('LOC Anchor ZModel group mapping missing: '+type);
  return [type,{field:ANCHOR_TYPE_GROUP_FIELDS[type],
    validator:modelFactory.makeTypeSchema(ANCHOR_GROUP_MODEL_NAMES[group])}];
}));

function validateAnchorPayload(type,attr){
  const entry=anchorPayloadValidators.get(String(type||''));
  if(!entry||attr===undefined)return;
  // Pattern postings stay in their existing dynamic object shape, but the
  // surrounding group model still enforces the discriminator field.
  const payload=type==='pattern'?{postings:attr}:attr;
  const parsed=entry.validator.safeParse({[entry.field]:payload});
  if(parsed.success)return;
  const issue=parsed.error.issues[0];
  const field=issue?.path?.join('.')||'(attr)';
  throw new TypeError('LOC Anchor ZModel payload 驗證失敗：'+field+
    ' — '+(issue?.message||'invalid value'));
}

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
    }else if(column.format==='int8'){
      // JSON transports represent PostgreSQL BIGINT as a safe JS number or
      // decimal string, not a native bigint. Keep the physical 64-bit range
      // and preserve original values for the existing Kysely JSONB batches.
      const int8Text=z.string().max(20).regex(/^-?[0-9]+$/).refine(value=>{
        if(!/^-?[0-9]+$/.test(value))return false;
        try{
          const n=BigInt(value);
          return n>=-(1n<<63n)&&n<=(1n<<63n)-1n;
        }catch{return false;}
      });
      overrides[column.name]=z.union([
        field,z.number().int().min(Number.MIN_SAFE_INTEGER)
          .max(Number.MAX_SAFE_INTEGER),int8Text
      ]);
    }else if(column.format==='date'){
      // PostgreSQL DATE accepts YYYY-MM-DD; native ZModel maps it to DateTime.
      overrides[column.name]=z.union([field,z.iso.date()]).nullable().optional();
    }else if(column.format.startsWith('_')&&column.nullable){
      // ZModel V3 does not represent nullable list columns losslessly.
      overrides[column.name]=field.nullable().optional();
    }
  }
  // Preserve every ZModel-derived field schema, but reject foreign columns
  // instead of relying on Zod's default unknown-key stripping on writes.
  const result=z.strictObject({...base.shape,...overrides});
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

// Management Galaxy INSERT/UPSERT and partial UPDATE/UPDATE_BATCH share the
// import's authoritative ZModel→Zod schema, but retain their existing SQL
// operations, authorized Scope, and database defaults.
const partialWriteSchemas=new WeakMap();
function partialWriteSchema(full){
  let partial=partialWriteSchemas.get(full);
  if(!partial){
    partial=full.partial();
    partialWriteSchemas.set(full,partial);
  }
  return partial;
}

/** Validate Galaxy writes only; other authorized models keep their own rules.
 * Returns false for non-Galaxy relations. Input rows are never rewritten.
 * The server must verify network input even when the import UI prevalidated it.
 */
export function assertZModelGalaxyManagedValues(table,operation,values){
  if(!scopedGalaxy.test(String(table||''))||
     !['insert','upsert','update','update_batch'].includes(operation))
    return false;
  const schema=modelWriteSchemaForSqlTable(table);
  const partial=operation==='update'||operation==='update_batch';
  const validator=partial?partialWriteSchema(schema):schema;
  const rows=operation==='update'?[values]:values;
  if(!Array.isArray(rows))throw new TypeError('Invalid LOC Galaxy managed rows');
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    // Batch location enrichment has always treated an empty place as a
    // no-op; preserve that SQL behavior without relaxing CHAR(8) for real IDs.
    const check=operation==='update_batch'&&row?.place_id===''?
      Object.fromEntries(Object.entries(row).filter(([key])=>key!=='place_id')):
      row;
    const parsed=validator.safeParse(check);
    if(parsed.success&&(
      operation!=='update_batch'||typeof row.uid==='string'&&char8Uid.test(row.uid)
    ))continue;
    const first=parsed.success?{path:['uid'],message:'Expected exactly 8 ASCII letters or digits'}:
      parsed.error.issues[0];
    const field=first?.path?.join('.')||'(record)';
    // Field and row index only: never expose personal article text.
    throw new TypeError('LOC Galaxy ZModel 寫入驗證失敗：第 '+(i+1)+
      ' 筆 '+field+' — '+(first?.message||'invalid value'));
  }
  return true;
}

// Share the very same ZModel-derived strict shapes with existing Anchor and
// Block management writes. LOC-wide source Anchors use the fixed contract;
// independently named external relations are not silently mapped.
export function assertZModelAnchorBlockManagedValues(table,operation,values){
  if(!['insert','upsert','update'].includes(operation))return false;
  const relation=String(table||'');
  if(!/^silver\.[a-z][a-z0-9]{0,14}_(?:anchor|blocks)$/.test(relation))return false;
  const model=modelNameForSql(...relation.split('.'));
  if(!model||!(model.endsWith('Anchor')||model.endsWith('Blocks')))
    return false;
  const full=modelWriteSchemaForSqlTable(relation);
  const validator=operation==='update'?partialWriteSchema(full):full;
  const rows=operation==='update'?[values]:values;
  if(!Array.isArray(rows))
    throw new TypeError('Invalid LOC Anchor/Block managed rows');
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    const parsed=validator.safeParse(row);
    if(!parsed.success){
      const issue=parsed.error.issues[0];
      const field=issue?.path?.join('.')||'(record)';
      // Reject unknown columns and incompatible values before SQL; never echo
      // private text, JSON attrs, or caller-supplied values in diagnostics.
      throw new TypeError('LOC '+(model.endsWith('Anchor')?'Anchor':'Block')+
        ' ZModel 寫入驗證失敗：第 '+(i+1)+' 筆 '+field+
        ' — '+(issue?.message||'invalid value'));
    }
    // The discriminator selects the semantic ZModel payload. Updates that
    // omit `type` cannot be checked without a database read, so they retain
    // the existing partial-write contract and are validated on the next full
    // typed write.
    if(model.endsWith('Anchor'))validateAnchorPayload(row?.type,row?.attr);
  }
  return true;
}

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
