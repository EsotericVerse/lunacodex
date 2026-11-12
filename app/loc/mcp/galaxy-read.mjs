import {sql} from 'kysely';
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {portableContainsSpec} from '../providers/portable-search.mjs';
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {scopedZModelSchema} from '../../../zenstack/scoped-schema.mjs';
import {createScopedLocClient} from '../../../zenstack/client.mjs';
import {directMcpKysely} from './native-kysely.mjs';

// This is a specific read model executed by the trusted MCP application, NOT
// a generic SQL transport. No HTTP SQL endpoint, provider SDK or DB credential
// is selected by an OAuth caller.
const PUBLIC_SCOPE_IDS=Object.freeze(SCOPE_ROUTE_INDEX.filter(row=>row.active&&row.scope_id!=='loc')
  .map(row=>row.scope_id).filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id)));
const UID=/^[A-Za-z0-9]{8}$/;
function bad(message){return Object.assign(new Error(message),{code:'INVALID_ARGUMENT'});}
function unavailable(message){return Object.assign(new Error(message),{code:'BACKEND_UNAVAILABLE'});}
function scopeAllowed(value){
  const id=value??PUBLIC_SCOPE_IDS[0];
  if(!PUBLIC_SCOPE_IDS.includes(id))throw bad('Only configured public Galaxy Scopes are available');
  return id;
}
async function scopedDatabase(scopeid,env){
  const port=await directMcpKysely(env);
  if(!port?.db||typeof port.db.selectFrom!=='function'||
     port.engine!=='postgres')
    throw unavailable('LOC MCP direct SQL driver is unavailable');
  const namespace=port.namespace??'silver';
  if(namespace&&!/^[A-Za-z][A-Za-z0-9_]*$/.test(namespace))
    throw unavailable('LOC MCP SQL namespace is invalid');
  // The existing Galaxy ZModel owns the physical mapping AND column contract.
  // Use its scoped Kysely-backed query builder when a real trusted dialect is
  // present; injected test ports without a dialect retain their SQL adapter.
  const galaxy=scopedZModelSchema({scopeId:scopeid,namespace}).models.Galaxy;
  const required=['uid','title','content','createtime','date','site','url','search','list'];
  if(required.some(field=>!Object.hasOwn(galaxy.fields,field)))
    throw unavailable('Galaxy ZModel read contract mismatch');
  const relation=galaxy.attributes.find(attr=>attr.name==='@@map')
    ?.args?.[0]?.value?.value;
  if(typeof relation!=='string'||!relation)
    throw unavailable('Galaxy ZModel table mapping is missing');
  if(port.dialect){
    const client=createScopedLocClient({dialect:port.dialect,scopeId:scopeid,namespace});
    return {db:client.$qb,table:'Galaxy'};
  }
  return {db:port.db,table:portableRelation(relation,port.engine,namespace)};
}
// Private MCP conversations and old PR development records must never leak
// from a public Galaxy read even if a historical Boolean was set incorrectly.
const publicSite=sql`( ${sql.ref('site')} is null or lower(${sql.ref('site')}) not in (${sql.join(['mcp','github'])}) )`;

export async function searchMemory(args={},env={}){
  if(args.user_requested!==true)
    throw bad('只有使用者明確要求時，才允許搜尋對話；禁止代理自行搜尋。');
  const scopeid=scopeAllowed(args.scopeid);
  if(typeof args.query!=='string')throw bad('query is required');
  const term=args.query.trim();
  if(/(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i.test(term))
    throw bad('請至github頁面找尋PR相關資料！不開放搜尋PR!');
  if(term.length<2||term.length>100||/[\u0000-\u001f\u007f]/.test(term))
    throw bad('query must contain 2–100 characters without control characters');
  const limit=args.limit===undefined?10:Number(args.limit);
  const offset=args.offset===undefined?0:Number(args.offset);
  if(!Number.isInteger(limit)||limit<1||limit>20)throw bad('limit must be between 1 and 20');
  if(!Number.isInteger(offset)||offset<0||offset>500)throw bad('offset must be between 0 and 500');
  const {db,table}=await scopedDatabase(scopeid,env);
  const spec=portableContainsSpec(term);
  const columnLike=column=>sql`${spec.fold?sql`lower(${sql.ref(column)})`:sql.ref(column)} like ${spec.pattern} escape '!'`;
  const rows=await db.selectFrom(table)
    .select(['uid','title','date','createtime'])
    .where('search','=',true).where(publicSite)
    .where(eb=>eb.or([columnLike('title'),columnLike('content')]))
    .orderBy('date','desc').orderBy('createtime','desc')
    .limit(limit).offset(offset).execute();
  return {scopeid,visibility:'public',query:term,limit,offset,
    results:rows.map(row=>({uid:String(row.uid||'').trim(),title:row.title||'',
      date:row.date||null,createtime:row.createtime||null})),
    has_more:rows.length===limit};
}
export async function readMemory(args={},env={}){
  const scopeid=scopeAllowed(args.scopeid);
  const uid=String(args.uid||'').trim();
  if(!UID.test(uid))throw bad('uid must be an 8-character, case-sensitive Base62 ID');
  const offset=args.offset===undefined?0:Number(args.offset);
  const maxChars=args.max_chars===undefined?20000:Number(args.max_chars);
  if(!Number.isInteger(offset)||offset<0||offset>1000000)throw bad('offset must be 0–1000000');
  if(!Number.isInteger(maxChars)||maxChars<1||maxChars>40000)
    throw bad('max_chars must be 1–40000');
  const {db,table}=await scopedDatabase(scopeid,env);
  const rows=await db.selectFrom(table)
    .select(['uid','title','content','date','createtime','site','url'])
    .where('uid','=',uid).where('list','=',true).where(publicSite)
    .limit(1).execute();
  if(!rows.length)return {found:false,scopeid,uid,visibility:'public'};
  const row=rows[0],content=String(row.content||'');
  return {found:true,scopeid,visibility:'public',uid:String(row.uid||'').trim(),
    title:row.title||'',date:row.date||null,createtime:row.createtime||null,
    site:row.site||null,url:row.url||null,content:content.slice(offset,offset+maxChars),
    offset,total_chars:content.length,next_offset:offset+maxChars<content.length?offset+maxChars:null};
}
