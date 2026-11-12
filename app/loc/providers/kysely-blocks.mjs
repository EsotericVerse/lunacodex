import {sql} from 'kysely';
import {buildKyselyUpsertQuery} from './kysely-runtime.mjs';
import {portableRelation,serializePortableJsonFields} from './sql-engine-ports.mjs';
import {modelFieldsForSql} from '../../../zenstack/model-column-guard.mjs';
import {importSchemaForSqlTable} from '../../../zenstack/import-validation.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const PAGE=/^[A-Za-z][A-Za-z0-9_-]{0,60}$/;
// The fixed and dynamic Block tables have one frozen ZenStack field contract.
// Keep the editor's own page/order/UID business rules below.
const FIELDS=new Set(Object.keys(modelFieldsForSql('silver','lo3rwang_blocks')));
function reject(message){
  throw Object.assign(new Error(message),{httpStatus:400});
}
// One authenticated, transactional save for one complete Block page. Authority
// verification occurs once in the caller; this function never checks grants
// again per Block. The input is the full page snapshot, not a list of patches.
export async function saveBlocksKysely(db,args,{engine='postgres',namespace='silver'}={}){
  const scope=String(args?.p_scope_id||'').trim().toLowerCase();
  const type=String(args?.p_type||'').trim();
  const supplied=args?.p_rows;
  if(!SCOPE.test(scope)||!PAGE.test(type)||!Array.isArray(supplied)||supplied.length>50)
    reject('Invalid Block save request');
  const tableName=scope==='loc'?'loc_blocks':scope+'_blocks';
  const table=engine==='postgres'?'silver.'+tableName:
    portableRelation(tableName,engine,namespace);
  // Reuse the already cached ZenStack→Zod model schema used by Galaxy import.
  // No separate Block field, UID or physical-type validator is maintained here.
  const blockSchema=importSchemaForSqlTable('silver.'+tableName);
  const seen=new Set(),orders=new Set();
  const rows=supplied.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||
       Object.keys(row).some(key=>!FIELDS.has(key)))
      reject('Invalid Block data');
    const uid=String(row.uid);
    const order=Number(row.block_order);
    if(seen.has(uid)||!Number.isSafeInteger(order)||order<0||orders.has(order))
      reject('Duplicate Block UID or order');
    seen.add(uid);orders.add(order);
    const entity=row.block_entity??[];
    if(!Array.isArray(entity)&&(!entity||typeof entity!=='object'))
      reject('Invalid Block entities');
    const image=row.block_image;
    const normalized={
      uid,page_name:type,block_order:order,
      block_eyebrow:String(row.block_eyebrow||''),
      block_title:String(row.block_title||''),
      block_subtitle:String(row.block_subtitle||''),
      block_text:String(row.block_text||''),
      block_entity:entity,
      block_image:image==null?null:typeof image==='string'?image:JSON.stringify(image)
    };
    // Validate against the actual ZModel fields before any Kysely SELECT/UPSERT.
    if(!blockSchema.safeParse(normalized).success)reject('Invalid Block data');
    return normalized;
  });
  // One SELECT checks existing UIDs and defines the removed rows. It also
  // prevents a batch from replacing a Block belonging to another page.
  const existing=await db.selectFrom(table)
    .select(['uid','page_name']).execute();
  const outside=new Set(existing.filter(row=>row.page_name!==type)
    .map(row=>String(row.uid)));
  if(rows.some(row=>outside.has(row.uid)))reject('Block UID belongs to another page');
  const removed=existing.filter(row=>row.page_name===type&&!seen.has(String(row.uid)))
    .map(row=>String(row.uid));
  if(rows.length){
    const payload=engine==='postgres'?rows.map(row=>({
      ...row,block_entity:sql`${JSON.stringify(row.block_entity)}::jsonb`
    })):serializePortableJsonFields(rows,engine);
    const query=buildKyselyUpsertQuery(db,{
      schema:'silver',table:tableName,values:payload,
      onConflict:['uid'],ignoreDuplicates:false
    },engine,namespace);
    await query.execute();
  }
  if(removed.length)await db.deleteFrom(table).where('page_name','=',type)
    .where('uid','in',removed).execute();
  return {rows,count:rows.length,removed:removed.length};
}
