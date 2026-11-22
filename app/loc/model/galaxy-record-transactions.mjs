// Fixed article/related-UID projection over one published Scope.
// No user-selected SQL, table, columns, predicate, model or database target.
import {z} from 'zod';
import {galaxyReadColumnsFor} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';

const scopes=new Set(SCOPE_ROUTE_INDEX.filter(s=>s.active!==false&&
  s.scope_id!=='loc'&&s.scope_id!=='admin').map(s=>s.scope_id));
const UID=z.string().regex(/^[A-Za-z0-9]{8}$/);
const schema=z.object({
  kind:z.literal('transaction'),operation:z.literal('galaxy-records'),
  scope:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  view:z.enum(['list','detail']),mode:z.enum(['public','editor']).default('public'),
  uids:z.array(UID).min(1).max(100)
}).strict();
export function parseGalaxyRecordTransaction(body){
  const parsed=schema.safeParse(body);
  if(!parsed.success||!scopes.has(parsed.data?.scope)||
    parsed.data.view==='detail'&&parsed.data.uids.length!==1||
    new Set(parsed.data.uids).size!==parsed.data.uids.length)
    throw Object.assign(Error('Invalid Galaxy UID model'),{httpStatus:400});
  return parsed.data;
}
const PRIVATE_SITES=['mcp','github','messenger','chatgpt','claude','gemini',
  'whatsapp','telegram','discord','line','wechat','teams','copilot','grok'];
export async function executeGalaxyRecordTransaction(trx,body){
  const columns=body.view==='list'
    ?galaxyReadColumnsFor('GalaxyList')
    :[...new Set([...galaxyReadColumnsFor('GalaxyUidRead','GalaxyAttr'),
      'media_link','site_id'])];
  let query=trx.selectFrom('silver.'+body.scope+'_galaxy')
    .select(columns).where('uid','in',body.uids);
  if(body.mode==='public')
    query=query.where('list','=',true).where(eb=>eb.or([
      eb('site','is',null),
      eb(eb.fn('lower',['site']),'not in',PRIVATE_SITES)
    ]));
  const rows=await query.execute();
  const found=new Map(rows.map(row=>[String(row.uid),row]));
  return {rows:body.uids.map(uid=>found.get(uid)).filter(Boolean)};
}
