// Fixed Anchor feature model for Time, Space, Source and Media UIs.
// This is not Search: only an exact published Scope + model family is allowed.
import {z} from 'zod';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {assertZModelAnchorFeatureRows} from '../../../packages/zenstack/import-validation.mjs';
const scopes=new Set(SCOPE_ROUTE_INDEX.filter(x=>x.active!==false).map(x=>x.scope_id));
const UID=z.string().regex(/^[A-Za-z0-9]{8}$/);
const DAY=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function calendarDate(value){return !Number.isNaN(Date.parse(value+'T00:00:00Z'))&&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
const schema=z.object({
  kind:z.literal('transaction'),operation:z.literal('anchor-feature'),
  scope:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  family:z.enum(['time','space','source','media']),
  mode:z.enum(['public','editor']).default('public'),
  types:z.array(z.string()).min(1).max(12).optional(),
  uids:z.array(UID).min(1).max(100).optional(),
  cursor:UID.optional(),offset:z.number().int().min(0).max(10000).optional(),
  limit:z.number().int().min(1).max(1000).optional(),
  order:z.enum(['uid','title','createtime']).optional(),
  sortDirection:z.enum(['asc','desc']).optional(),
  startDate:DAY.optional(),endDate:DAY.optional(),
  result:z.enum(['rows','count']).default('rows'),includeTotal:z.boolean().optional(),
  // The page name belongs to Blocks, not the Anchor search API.
}).strict();
export function parseAnchorFeatureTransaction(body){
  const parsed=schema.safeParse(body);
  if(!parsed.success)throw Object.assign(Error('Invalid Anchor feature model'),{httpStatus:400});
  const value=parsed.data,allowed=ANCHOR_TYPE_GROUPS[value.family];
  if(!scopes.has(value.scope)||value.scope==='admin'||value.scope==='loc'&&
    value.family!=='source'||!Array.isArray(allowed)||
    value.types?.some(type=>!allowed.includes(type))||
    value.uids&&value.cursor||value.cursor&&value.offset!==undefined||
    value.uids&&value.uids.length>100||
    value.startDate&&!calendarDate(value.startDate)||
    value.endDate&&!calendarDate(value.endDate)||
    value.startDate&&value.endDate&&value.startDate>value.endDate||
    (value.startDate||value.endDate)&&value.family!=='media'||
    value.cursor&&value.order&&value.order!=='uid'||
    value.cursor&&value.sortDirection==='desc'||
    value.result==='count'&&(value.cursor||value.offset!==undefined||
      value.includeTotal!==undefined))
    throw Object.assign(Error('Invalid Anchor feature selection'),{httpStatus:400});
  return {...value,types:value.types||allowed,limit:value.limit||1000,
    order:value.order||'uid'};
}
export async function executeAnchorFeatureTransaction(trx,model){
  const table='silver.'+(model.scope==='loc'?'loc_anchor':model.scope+'_anchor');
  let query=trx.selectFrom(table).where('type','in',model.types);
  if(model.mode==='public')query=query.where('invisible','=',false);
  if(model.uids)query=query.where('uid','in',model.uids);
  if(model.cursor)query=query.where('uid','>',model.cursor);
  // MediaAnchor time windows use the existing physical createtime. The bounds
  // are Taipei calendar days, not an additional time/anchor mapping table.
  if(model.startDate)query=query.where('createtime','>=',model.startDate+'T00:00:00+08:00');
  if(model.endDate)query=query.where('createtime','<=',model.endDate+'T23:59:59.999+08:00');
  if(model.result==='count'){
    const row=await query.select(eb=>eb.fn.countAll().as('total')).executeTakeFirst();
    return {total:Number(row?.total||0)};
  }
  // An exact count is optional and runs on the same Transaction snapshot.
  const totalCount=model.includeTotal?
    Number((await query.select(eb=>eb.fn.countAll().as('total'))
      .executeTakeFirst())?.total||0):null;
  const direction=model.sortDirection||'asc';
  if(model.cursor&&(model.order!=='uid'||direction!=='asc'))
    throw Object.assign(Error('Anchor cursor requires ascending UID'),{httpStatus:400});
  let page=query.select([
    'uid','type','title','description','attr','invisible','createtime'
  ]).orderBy(model.order,direction);
  if(model.order!=='uid')page=page.orderBy('uid','asc');
  const rows=await page.limit(model.limit+1).offset(model.offset||0).execute();
  const visible=assertZModelAnchorFeatureRows(rows.slice(0,model.limit));
  return {rows:visible,hasMore:rows.length>model.limit,totalCount,
    nextCursor:rows.length>model.limit&&visible.length&&
      model.order==='uid'&&direction==='asc'
      ?String(visible.at(-1).uid):null};
}
