// Fixed Lucus feature model for Time, Space and Source UIs.
// This is not Search: only an exact published Scope + model family is allowed.
import {z} from 'zod';
import {sql} from 'kysely';
import {MAX_ROWS,TIME_LUCUS_MAX_PAGE_ROWS} from '../query/query-batch-size.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {LUCUS_TYPE_GROUPS} from '../../../packages/zenstack/lucus-hierarchy.mjs';
import {scopeRelationName} from '../../../packages/zenstack/scope-table-names.mjs';
import {assertZModelLucusFeatureRows} from '../../../packages/zenstack/import-validation.mjs';
const scopes=new Set(SCOPE_ROUTE_INDEX.filter(x=>x.active!==false).map(x=>x.scope_id));
const UID=z.string().regex(/^[A-Za-z0-9]{8}$/);
const schema=z.object({
  kind:z.literal('query'),operation:z.literal('lucus-feature'),
  scope:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  family:z.enum(['time','space','source']),
  mode:z.enum(['public','editor']).default('public'),
  types:z.array(z.string()).min(1).max(12).optional(),
  uids:z.array(UID).min(1).max(100).optional(),
  dateStart:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateEnd:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor:UID.optional(),offset:z.number().int().min(0).max(10000).optional(),
  limit:z.number().int().min(1).max(TIME_LUCUS_MAX_PAGE_ROWS).optional(),
  order:z.enum(['uid','title','createtime']).optional(),
  sortDirection:z.enum(['asc','desc']).optional(),
  result:z.enum(['rows','count']).default('rows'),includeTotal:z.boolean().optional(),
  // The page name belongs to Blocks, not the Lucus search API.
}).strict();
function validIsoDate(value){
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function parseLucusFeatureQuery(body){
  const parsed=schema.safeParse(body);
  if(!parsed.success)throw Object.assign(Error('Invalid Lucus feature model'),{httpStatus:400});
  const value=parsed.data,allowed=LUCUS_TYPE_GROUPS[value.family];
  // The entire SiteLucus taxonomy exists ONLY in silver.loc_lucus.
  // Source is never a family within an author's private <scope>_lucus.
  if(!scopes.has(value.scope)||value.scope==='admin'||
    (value.family==='source')!==(value.scope==='loc')||!Array.isArray(allowed)||
    value.types?.some(type=>!allowed.includes(type))||
    (value.dateStart===undefined)!==(value.dateEnd===undefined)||
    (value.dateStart!==undefined&&(value.family!=='time'||
      !(value.types||allowed).includes('date')||value.dateStart>value.dateEnd||
      !validIsoDate(value.dateStart)||!validIsoDate(value.dateEnd)))||
    value.uids&&value.cursor||value.cursor&&value.offset!==undefined||
    value.uids&&value.uids.length>100||
    value.cursor&&value.order&&value.order!=='uid'||
    value.cursor&&value.sortDirection==='desc'||
    value.result==='count'&&(value.cursor||value.offset!==undefined||
      value.includeTotal!==undefined))
    throw Object.assign(Error('Invalid Lucus feature selection'),{httpStatus:400});
  return {...value,types:value.types||allowed,
    // COUNT queries have no SQL LIMIT; only row projections have page bounds.
    limit:value.result==='count'?null:(value.limit??MAX_ROWS),
    order:value.order||'uid'};
}
function dateAttributeExpression(engine){
  const attr=sql.ref('attr');
  if(engine==='postgres')return sql`(${attr}->>'date')`;
  if(engine==='mysql')return sql`JSON_UNQUOTE(JSON_EXTRACT(${attr}, '$.date'))`;
  if(engine==='mssql')return sql`JSON_VALUE(${attr}, '$.date')`;
  throw Error('Unsupported Lucus SQL dialect');
}
export async function executeLucusFeatureQuery(db,model,port={}){
  const table=model.family==='source'
    ?scopeRelationName('loc','lucus'):
      scopeRelationName(model.scope,'lucus');
  let query=db.selectFrom(table).where('type','in',model.types);
  if(model.mode==='public')query=query.where('invisible','=',false);
  // Keep Era/Period metadata, but materialize DateLucus only inside the
  // requested window. This is one bounded TimeLucus read, not an all-history scan.
  if(model.dateStart){
    const date=dateAttributeExpression(port.engine);
    query=query.where(sql`(${sql.ref('type')} <> 'date' or (
      ${date} >= ${model.dateStart} and ${date} <= ${model.dateEnd}
    ))`);
  }
  if(model.uids)query=query.where('uid','in',model.uids);
  if(model.cursor)query=query.where('uid','>',model.cursor);
  if(model.result==='count'){
    const row=await query.select(eb=>eb.fn.countAll().as('total')).executeTakeFirst();
    return {total:Number(row?.total||0)};
  }
  // An exact count is optional and runs as a separate SELECT; reads are not
  // wrapped in a database transaction.
  const totalCount=model.includeTotal?
    Number((await query.select(eb=>eb.fn.countAll().as('total'))
      .executeTakeFirst())?.total||0):null;
  const direction=model.sortDirection||'asc';
  if(model.cursor&&(model.order!=='uid'||direction!=='asc'))
    throw Object.assign(Error('Lucus cursor requires ascending UID'),{httpStatus:400});
  let page=query.select([
    'uid','type','title','description','attr','invisible','createtime'
  ]).orderBy(model.order,direction);
  if(model.order!=='uid')page=page.orderBy('uid','asc');
  const rows=await page.limit(model.limit+1).offset(model.offset||0).execute();
  const visible=assertZModelLucusFeatureRows(rows.slice(0,model.limit));
  return {rows:visible,hasMore:rows.length>model.limit,totalCount,
    nextCursor:rows.length>model.limit&&visible.length&&
      model.order==='uid'&&direction==='asc'
      ?String(visible.at(-1).uid):null};
}
