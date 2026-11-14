// Fixed public LOC business reads in the EXISTING Pages application runtime.
// Kysely talks to the database itself. No generic SQL endpoint, arbitrary
// table/column/operator input, connection URL, or browser-selected driver.
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {scopeConfigColumns,scopeFeatureEnabled} from '../scope-config-fields.mjs';
import {directMcpKysely} from '../mcp/native-kysely.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {fixedPolicyReadModel,withFixedPolicyRead} from '../../../zenstack/policy-runtime.mjs';
import {createScopedLocClient} from '../../../zenstack/client.mjs';
import {assertZModelSelectRows} from '../../../zenstack/import-validation.mjs';
import {LOC_BLOCK_ANCHOR_FIELDS} from '../loc-block-anchor.mjs';
import {block_list,hero_block} from '../providers/kysely-public.mjs';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const BLOCK_FIELDS=['uid','page_name','block_eyebrow','block_title','block_subtitle',
  'block_text','block_order','block_entity','block_image'];
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const allowedScope=id=>SCOPE_ROUTE_INDEX.some(row=>row.scope_id===id&&row.active!==false);
const NUMERIC_KINDS=new Set(['culture_density','daily','daily_total','overview','earliest','totals','loc']);
// Numeric Culture/Statistics queries aggregate the full source: no row-group ceiling.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
const total=value=>Number(value)||0;

// LOC Group totals aggregate fixed published child Scope totals, not article
// rows or user-selected tables. All database reads stay in existing Kysely.
async function readLocGroupNumeric(db,start,end,port){
  const entries=SCOPE_ROUTE_INDEX.filter(row=>row.scope_id!=='loc'&&row.active!==false&&
    scopeFeatureEnabled(row.config,'statistics_able'));
  const scopes=[],rows=[];let earliest='';
  for(const entry of entries){
    const id=entry.scope_id;
    // Reuse the daily TOTAL-only query for the LOC aggregate. No site GROUP
    // BY, Source taxonomy or Anchor JOIN occurs even for combined scopes.
    const summary=await readGalaxyNumeric(db,id,'daily_total',
      start||'0001-01-01',end||'9999-12-31',port);
    scopes.push({scope_id:id,display_name:String(entry.config?.display_name||id)});
    rows.push(...summary.rows.map(row=>({
      scope_id:id,day:row.day,item_count:row.item_count
    })));
    const first=summary.earliest;
    if(first&&(!earliest||first<earliest))earliest=first;
  }
  return {earliest,scopes,rows};
}
// A fixed, bounded Galaxy aggregation performed where the native connection
// already lives. Never download per-article rows to aggregate in a browser;
// never infer Galaxy.site from a Source Anchor display label.
async function readGalaxyNumeric(db,scope,kind,start,end,port){
  const table=portableRelation(scope+'_galaxy',port.engine,
    port.namespace||(port.engine==='postgres'?'silver':'dbo'));
  const isCulture=kind==='culture_density';
  if(kind==='earliest'){
    const first=await db.selectFrom(table).select(eb=>eb.fn.min('date').as('earliest'))
      .where('statics','=',true).where('date','is not',null).executeTakeFirst();
    return day(first?.earliest)||'';
  }
  if(kind==='daily_total'){
    // Statistics landing is TOTAL-ONLY: no Source/Galaxy.site GROUP BY,
    // no Anchor join, no article list and no additional taxonomy SELECT.
    const [counts,first]=await Promise.all([
      db.selectFrom(table).select('date')
        .select(eb=>eb.fn.countAll().as('item_count'))
        .where('statics','=',true).where('date','>=',start)
        .where('date','<=',end).where('date','is not',null)
        .groupBy('date').orderBy('date','asc').execute(),
      db.selectFrom(table).select(eb=>eb.fn.min('date').as('earliest'))
        .where('statics','=',true).where('date','is not',null)
        .executeTakeFirst()
    ]);
    return {earliest:day(first?.earliest)||'',
      rows:counts.map(row=>({day:day(row.date),item_count:total(row.item_count)}))};
  }
  if(kind==='totals'){
    let query=db.selectFrom(table).select('site')
      .select(eb=>eb.fn.countAll().as('item_count'))
      .where('statics','=',true).where('date','is not',null);
    if(start)query=query.where('date','>=',start).where('date','<=',end);
    const rows=await query.groupBy('site').orderBy('site','asc').execute();
    return rows.map(row=>({kind:'source',category:String(row.site||''),
      item_count:total(row.item_count)}));
  }
  const q=db.selectFrom(table).select(['date','site'])
    .select(eb=>eb.fn.countAll().as('item_count'))
    .where(isCulture?'culture':'statics','=',true)
    .where('date','>=',start).where('date','<=',end)
    .where('date','is not',null)
    .groupBy(['date','site']).orderBy('date','asc');
  const [raw,first]=await Promise.all([
    q.execute(),
    kind==='overview'?db.selectFrom(table)
      .select(eb=>eb.fn.min('date').as('earliest'))
      .where('statics','=',true).where('date','is not',null)
      .executeTakeFirst():Promise.resolve(null)
  ]);
  if(isCulture)return raw.map(row=>({day:day(row.date),
    site:String(row.site||''),item_count:total(row.item_count)}));
  // One grouped SQL query supplies both the Source and Total rows. It is not
  // necessary to query the Galaxy table again to count each calendar day.
  const totals=new Map(),rows=[];
  for(const row of raw){
    const date=day(row.date),count=total(row.item_count);
    rows.push({day:date,kind:'source',category:String(row.site||''),item_count:count});
    totals.set(date,(totals.get(date)||0)+count);
  }
  rows.push(...[...totals].map(([date,count])=>({
    day:date,kind:'total',category:'文字作品',item_count:count
  })));
  rows.sort((a,b)=>a.day.localeCompare(b.day)||a.kind.localeCompare(b.kind));
  return kind==='overview'?{earliest:day(first?.earliest)||'',rows,categories:[],aliases:[]}:rows;
}

export async function handleNativePublicContent(request,env={},{
  database=directMcpKysely
}={}){
  if(request.method!=='GET')return respond({error:'GET required'},405);
  const url=new URL(request.url);
  const kind=url.searchParams.get('kind');
  const scope=String(url.searchParams.get('scope')||'');
  const feature=String(url.searchParams.get('feature')||'');
  const heroTypes=feature?feature.split(','):[];
  const validHero=heroTypes.length>0&&heroTypes.length<=2&&
    new Set(heroTypes).size===heroTypes.length&&heroTypes.every(type=>
      /^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(type)&&
      !['from','domain','galaxy','universe','index','governance'].includes(type));
  const keys=[...url.searchParams.keys()];
  const numeric=NUMERIC_KINDS.has(kind);
  const start=String(url.searchParams.get('start')||'');
  const end=String(url.searchParams.get('end')||'');
  if(!allowedScope(scope)||!['config','block_list','hero_block','culture_anchors'].includes(kind)&&!numeric||
      keys.some(key=>!['kind','scope','feature','start','end'].includes(key))||
      (kind==='hero_block'?scope!=='loc'||!validHero:Boolean(feature))||
      (!numeric&&(url.searchParams.has('start')||url.searchParams.has('end')))||
      (numeric&&((kind==='loc'?scope!=='loc':scope==='loc')||
        (kind!=='earliest'&&kind!=='totals'&&kind!=='loc'&&
          (!DAY.test(start)||!DAY.test(end)||start>end))||
        (kind==='earliest'&&(start||end))||
        ((kind==='totals'||kind==='loc')&&(Boolean(start)!==Boolean(end)||
          start&&(!DAY.test(start)||!DAY.test(end)||start>end))))))
    return respond({error:'Invalid LOC public content request'},400);
  // Release-published feature availability is a guest-visible rule; do not
  // query Manage or open SQL just to decide whether to serve a disabled feature.
  if(numeric){
    const published=SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scope);
    const flag=kind==='culture_density'?'culture_able':'statistics_able';
    if(!scopeFeatureEnabled(published?.config,flag))
      return respond({error:'Public feature unavailable'},403);
  }
  try{
    // Alias and credential are server-owned. An HTTP parameter must never
    // determine the engine, endpoint, connection profile or SQL relation.
    const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
    if(!primary)throw Error('LOC main SQL target is not configured');
    const port=await database(env,primary.target_id);
    if(!port?.db||!['postgres','mysql','mssql'].includes(port.engine))
      return respond({error:'LOC native database unavailable',stage:'driver'},503);
    const query=port.db;
    const relation=name=>portableRelation(name,port.engine,
      port.namespace||(port.engine==='postgres'?'silver':'dbo'));
    // ZenStack V3 shares the existing trusted Kysely dialect/pool; it does
    // not resolve credentials, create a second SQL target, or grant access.
    const scopedFor=id=>['postgres','mysql'].includes(port.engine)&&port.dialect
      ?createScopedLocClient({dialect:port.dialect,scopeId:id,
        engine:port.engine,namespace:port.namespace||'silver'}):null;
    if(numeric){
      const data=kind==='loc'
        ?await readLocGroupNumeric(query,start,end,port)
        :await readGalaxyNumeric(query,scope,kind,start,end,port);
      return respond({data});
    }
    if(kind==='culture_anchors'){
      // A public Scope's TimeAnchor history belongs to THAT Scope's
      // <scope>_anchor ZModel. The fixed loc_anchor model is the separate
      // LOC-wide taxonomy, not the author's TimeAnchor table.
      // Preserve the trusted published-Scope routing and invisible filter.
      const typed=scopedFor(scope);
      const rows=typed
        ?await typed.anchor.findMany({
            where:{type:{in:['date','period','era']},invisible:false},
            select:{uid:true,type:true,title:true,attr:true}
          })
        :await query.selectFrom(relation(scope+'_anchor'))
            .select(['uid','type','title','attr'])
            .where('type','in',['date','period','era'])
            .where('invisible','=',false).execute();
      if(!typed)assertZModelSelectRows('silver.'+scope+'_anchor',
        ['uid','type','title','attr'],rows);
      return respond({data:rows.map(row=>({...row,
        attr:typeof row.attr==='string'?JSON.parse(row.attr||'{}'):row.attr||{}
      }))});
    }
    if(kind==='config'){
      const data=await (async()=>{
        const columns=scopeConfigColumns(scope).split(',').filter(Boolean);
        // loc/lo3rwang/lrunes are fixed public ZModel control relations
        // (zenstack/policy-runtime.mjs). Route those through the real
        // ZenStack+PolicyPlugin reader -- same Kysely dialect/pool, no second
        // connection -- instead of the hand-rolled selectFrom below. A custom
        // Scope's own config table is not a fixed model, so it keeps the
        // existing plain Kysely path unchanged.
        const modelName=fixedPolicyReadModel({engine:port.engine},
          {kind:'query',schema:'silver',table:scope,operation:'select'});
        const row=modelName
          ?await withFixedPolicyRead(query,{engine:port.engine},
              {kind:'query',schema:'silver',table:scope,operation:'select'},
              'anon',{},{dialect:port.dialect,ZenStackClient,PolicyPlugin},
              (_qb,name,authorized)=>authorized[
                name[0].toLowerCase()+name.slice(1)].findFirst({
                  where:{id:scope},
                  select:Object.fromEntries(columns.map(column=>[column,true]))
                }))
          :await query.selectFrom(relation(scope))
              .select(columns).where('id','=',scope).limit(1).executeTakeFirst();
        if(!modelName)
          assertZModelSelectRows('silver.'+scope,columns,row?[row]:[]);
        return row||null;
      })();
      return respond({data});
    }
    // Only two presentation read contracts remain:
    // block_list(scopeid) for the homepage / LOC governance sections,
    // hero_block(exact type) for LOC's individual Hero records.
    const opts={engine:port.engine,namespace:port.namespace||'silver'};
    if(kind==='hero_block'||scope==='loc'){
      opts.readLocAnchors=async types=>{
        const anchorBody={kind:'query',schema:port.namespace||'silver',
          table:'loc_anchor',operation:'select'};
        const fixedAnchor=port.dialect
          ?fixedPolicyReadModel({engine:port.engine},anchorBody):null;
        return fixedAnchor
          ?withFixedPolicyRead(query,{engine:port.engine},anchorBody,
              'anon',{}, {dialect:port.dialect,ZenStackClient,PolicyPlugin},
              (_qb,name,authorized)=>authorized[
                name[0].toLowerCase()+name.slice(1)].findMany({
                  where:{type:{in:types},invisible:false},
                  select:Object.fromEntries(LOC_BLOCK_ANCHOR_FIELDS.map(field=>[field,true])),
                  orderBy:{num:'asc'}
                }))
          :query.selectFrom(relation('loc_anchor'))
              .select(LOC_BLOCK_ANCHOR_FIELDS)
              .where('type','in',types).where('invisible','=',false)
              .orderBy('num','asc').execute();
      };
    }
    if(kind==='hero_block')
      return respond({data:await hero_block(query,heroTypes,opts)});
    const table=relation(scope+'_blocks');
    const blockArgs={
      where:{page_name:'index'},
      select:Object.fromEntries(BLOCK_FIELDS.map(column=>[column,true])),
      orderBy:{block_order:'asc'}
    };
    opts.readScopeBlocks=async ()=>{
      const fixedBlockModel=port.dialect
        ?fixedPolicyReadModel({engine:port.engine},{kind:'query',
          schema:port.namespace||'silver',
          table:scope+'_blocks',operation:'select'})
        :null;
      const typed=scopedFor(scope);
      const data=fixedBlockModel
        ?await withFixedPolicyRead(query,{engine:port.engine},{kind:'query',
            schema:port.namespace||'silver',
            table:scope+'_blocks',operation:'select'},
            'anon',{}, {dialect:port.dialect,ZenStackClient,PolicyPlugin},
            (_qb,name,authorized)=>authorized[
              name[0].toLowerCase()+name.slice(1)].findMany(blockArgs))
        :typed?await typed.blocks.findMany(blockArgs)
        :await query.selectFrom(table).select(BLOCK_FIELDS)
            .where('page_name','=','index').orderBy('block_order','asc')
            .execute();
      if(!fixedBlockModel&&!typed)
        assertZModelSelectRows('silver.'+scope+'_blocks',BLOCK_FIELDS,data);
      return data;
    };
    return respond({data:await block_list(query,scope,opts)});
   }catch(error){
    // Categorize the real TCP/TLS/SQL failure without revealing credentials,
    // endpoints, query text or the raw driver error. No new connection attempt.
    let code='UNKNOWN',cause=error;
    const messages=[],types=[];
    for(let depth=0;cause&&depth<5;depth++,cause=cause.cause){
      if(code==='UNKNOWN'&&/^[A-Za-z0-9_]{2,40}$/.test(String(cause.code||'')))
        code=String(cause.code);
      messages.push(String(cause.message||'').toLowerCase());
      types.push(String(cause.name||''));
    }
    const message=messages.join(' ');
    const reason=
      /certificate|self.signed|tls|ssl|secure connection|handshake/.test(message)?'TLS':
      /password authentication|scram|sasl|authentication failed/.test(message)?'DB_AUTH':
      /permission denied|insufficient privilege/.test(message)?'DB_PRIVILEGE':
      /relation .* does not exist|undefined table/.test(message)?'DB_RELATION':
      /getaddrinfo|dns|name resolution|enotfound|eai_again/.test(message)?'DNS':
      /network|socket|connect|connection|timeout|timed out|unreachable|refused/.test(message)?'TRANSPORT':
      /unsupported|not implemented|not supported/.test(message)?'RUNTIME_UNSUPPORTED':
      /cannot read|is not a function|undefined|typeerror/.test(message)?'RUNTIME_TYPE':
      /pool|client/.test(message)?'DRIVER_POOL':'UNCLASSIFIED';
    const type=types.find(name=>
      ['Error','TypeError','SyntaxError','RangeError','AggregateError'].includes(name))||'Other';
    console.error('[LOC native public content]',{stage:'kysely-query',code,reason,type});
    return respond({error:'LOC native Kysely query failed',
      stage:'kysely-query',code,reason,type},503);
  }
}
