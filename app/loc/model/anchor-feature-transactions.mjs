// Fixed Anchor feature model for Time, Space, Source and Media UIs.
// This is not Search: only an exact published Scope + model family is allowed.
import {z} from 'zod';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
const scopes=new Set(SCOPE_ROUTE_INDEX.filter(x=>x.active!==false).map(x=>x.scope_id));
const UID=z.string().regex(/^[A-Za-z0-9]{8}$/);
const schema=z.object({
  kind:z.literal('transaction'),operation:z.literal('anchor-feature'),
  scope:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  family:z.enum(['time','space','source','media']),
  mode:z.enum(['public','editor']).default('public'),
  types:z.array(z.string()).min(1).max(12).optional(),
  uids:z.array(UID).min(1).max(100).optional(),
  cursor:UID.optional(),limit:z.number().int().min(1).max(1000).optional(),
  order:z.enum(['uid','title','createtime']).optional(),
  // The page name belongs to Blocks, not the Anchor search API.
}).strict();
export function parseAnchorFeatureTransaction(body){
  const parsed=schema.safeParse(body);
  if(!parsed.success)throw Object.assign(Error('Invalid Anchor feature model'),{httpStatus:400});
  const value=parsed.data,allowed=ANCHOR_TYPE_GROUPS[value.family];
  if(!scopes.has(value.scope)||value.scope==='admin'||value.scope==='loc'&&
    value.family!=='source'||!Array.isArray(allowed)||
    value.types?.some(type=>!allowed.includes(type))||
    value.uids&&value.cursor||
    value.uids&&value.uids.length>100)
    throw Object.assign(Error('Invalid Anchor feature selection'),{httpStatus:400});
  return {...value,types:value.types||allowed,limit:value.limit||1000,
    order:value.order||'uid'};
}
export async function executeAnchorFeatureTransaction(trx,model){
  const table='silver.'+(model.scope==='loc'?'loc_anchor':model.scope+'_anchor');
  let query=trx.selectFrom(table).select([
    'uid','type','title','description','attr','invisible','createtime'
  ]).where('type','in',model.types);
  if(model.mode==='public')query=query.where('invisible','=',false);
  if(model.uids)query=query.where('uid','in',model.uids);
  if(model.cursor)query=query.where('uid','>',model.cursor);
  // UID ordering provides stable cursor pagination. Custom order without a
  // keyset cursor is allowed only for exact UID sets (maximum 100).
  if(model.order!=='uid'&&!model.uids)
    throw Object.assign(Error('Anchor cursor requires UID ordering'),{httpStatus:400});
  const rows=await query.orderBy(model.order,'asc')
    .orderBy('uid','asc').limit(model.limit+1).execute();
  const page=rows.slice(0,model.limit);
  return {rows:page,nextCursor:rows.length>model.limit&&page.length
    ?String(page.at(-1).uid):null};
}
