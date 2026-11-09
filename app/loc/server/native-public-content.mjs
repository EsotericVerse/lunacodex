// Fixed public LOC business reads in the EXISTING Pages application runtime.
// Kysely talks to the database itself. No generic SQL endpoint, arbitrary
// table/column/operator input, connection URL, or browser-selected driver.
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {scopeConfigColumns,scopeFeatureEnabled} from '../scope-config-fields.mjs';
import {directMcpKysely} from '../mcp/native-kysely.mjs';
import {readPublishedGalaxyNumeric,PUBLISHED_GALAXY_SNAPSHOT_DATE} from './published-galaxy-fallback.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {createDirectDataApiClient} from '../providers/direct-data-api.mjs';
import {portableRelation} from '../providers/sql-engine-ports.mjs';
import {fixedPolicyReadModel,withFixedPolicyRead} from '../../../zenstack/policy-runtime.mjs';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';

const FEATURES=new Set(['culture','statics','trace','search']);
const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const BLOCK_FIELDS=['uid','page_name','block_eyebrow','block_title','block_subtitle',
  'block_text','block_order','block_entity','block_image'];
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const allowedScope=id=>SCOPE_ROUTE_INDEX.some(row=>row.scope_id===id&&row.active!==false);
const NUMERIC_KINDS=new Set(['culture_density','daily','overview','earliest','totals','loc']);
// Existing published Galaxy history exceeds 5,000 date/source groups. Bound
// the result by groups (never article rows) while preserving full-history views.
const MAX_PUBLIC_GROUPS=20000;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
const total=value=>Number(value)||0;

// Public presentation fallback stays inside the existing Pages application.
// It uses the published Data API with the anonymous key (never an owner token).
// This preserves live Config/Blocks/Hero reads when the native Kysely profile
// broker is unavailable, without exposing arbitrary SQL or private relations.
async function publicPresentationFallback(kind,scope,feature,env={}){
  const base=String(env.NEXT_PUBLIC_LOC_DATA_API_URL||
    env.LOC_DATA_API_URL||
    'https://qlouywsdiiyiyzpoxyqy.supabase.co/rest/v1');
  const apiKey=String(env.NEXT_PUBLIC_LOC_DATA_API_PUBLIC_KEY||
    env.LOC_DATA_API_PUBLIC_KEY||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
    'sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV');
  const client=createDirectDataApiClient({url:base,apiKey,role:'anon'});
  const from=table=>client.schema('silver').from(table);
  if(kind==='config'){
    const columns=scopeConfigColumns(scope);
    const {data}=await from(scope).select(columns).eq('id',scope).limit(1);
    return data?.[0]||null;
  }
  const table=kind==='hero'?'loc_blocks':scope+'_blocks';
  const names=kind==='hero'?['group_'+feature,'scope_'+feature]:['index'];
  const {data}=await from(table).select(BLOCK_FIELDS.join(','))
    .in('page_name',names).order('block_order',{ascending:true}).limit(100);
  return data||[];
}

// LOC Group totals aggregate fixed published child Scope totals, not article
// rows or user-selected tables. All database reads stay in existing Kysely.
async function readLocGroupNumeric(db,start,end,port){
  const entries=SCOPE_ROUTE_INDEX.filter(row=>row.scope_id!=='loc'&&row.active!==false&&
    scopeFeatureEnabled(row.config,'statistics_able'));
  const scopes=[],rows=[];let earliest='';
  for(const entry of entries){
    const id=entry.scope_id;
    const [daily,first]=await Promise.all([
      readGalaxyNumeric(db,id,'daily',start||'0001-01-01',end||'9999-12-31',port),
      readGalaxyNumeric(db,id,'earliest','','',port)
    ]);
    scopes.push({scope_id:id,display_name:String(entry.config?.display_name||id)});
    rows.push(...daily.filter(row=>row.kind==='total')
      .map(row=>({scope_id:id,day:row.day,item_count:row.item_count})));
    if(first&&(!earliest||first<earliest))earliest=first;
  }
  return {earliest,scopes,rows};
}
function publishedNumeric(scope,kind,start,end){
  if(kind!=='loc')return readPublishedGalaxyNumeric(scope,kind,start,end);
  const scopes=[],rows=[];let earliest='';
  for(const entry of SCOPE_ROUTE_INDEX){
    if(entry.scope_id==='loc'||entry.active===false||
        !scopeFeatureEnabled(entry.config,'statistics_able'))continue;
    const id=entry.scope_id;
    const daily=readPublishedGalaxyNumeric(id,'daily',start,end);
    if(!daily)continue;
    scopes.push({scope_id:id,display_name:String(entry.config?.display_name||id)});
    rows.push(...daily.filter(row=>row.kind==='total')
      .map(row=>({scope_id:id,day:row.day,item_count:row.item_count})));
    const first=readPublishedGalaxyNumeric(id,'earliest');
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
  if(kind==='totals'){
    let query=db.selectFrom(table).select('site')
      .select(eb=>eb.fn.countAll().as('item_count'))
      .where('statics','=',true).where('date','is not',null);
    if(start)query=query.where('date','>=',start).where('date','<=',end);
    const rows=await query.groupBy('site').orderBy('site','asc').limit(MAX_PUBLIC_GROUPS+1).execute();
    if(rows.length>MAX_PUBLIC_GROUPS)throw new Error('Too many Galaxy sources');
    return rows.map(row=>({kind:'source',category:String(row.site||''),
      item_count:total(row.item_count)}));
  }
  const q=db.selectFrom(table).select(['date','site'])
    .select(eb=>eb.fn.countAll().as('item_count'))
    .where(isCulture?'culture':'statics','=',true)
    .where('date','>=',start).where('date','<=',end)
    .where('date','is not',null)
    .groupBy(['date','site']).orderBy('date','asc').limit(MAX_PUBLIC_GROUPS+1);
  const [raw,first]=await Promise.all([
    q.execute(),
    kind==='overview'?db.selectFrom(table)
      .select(eb=>eb.fn.min('date').as('earliest'))
      .where('statics','=',true).where('date','is not',null)
      .executeTakeFirst():Promise.resolve(null)
  ]);
  if(raw.length>MAX_PUBLIC_GROUPS)throw new Error('Too many daily Galaxy groups');
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
  const keys=[...url.searchParams.keys()];
  const numeric=NUMERIC_KINDS.has(kind);
  const start=String(url.searchParams.get('start')||'');
  const end=String(url.searchParams.get('end')||'');
  if(!allowedScope(scope)||!['config','blocks','hero'].includes(kind)&&!numeric||
      keys.some(key=>!['kind','scope','feature','start','end'].includes(key))||
      (kind==='hero'?!FEATURES.has(feature):Boolean(feature))||
      (kind==='hero'&&!keys.includes('feature'))||
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
  // The already-published grouped snapshot preserves public reading while
  // the native Pages database connection is not yet configured.
  const publishedResponse=()=>{
    if(!numeric)return null;
    const data=publishedNumeric(scope,kind,start,end);
    return data===null?null:respond({data,source:'published',as_of:PUBLISHED_GALAXY_SNAPSHOT_DATE});
  };
  try{
    // Alias and credential are server-owned. An HTTP parameter must never
    // determine the engine, endpoint, connection profile or SQL relation.
    const publishedAlias=DATABASE_ACCESS_LIST.find(row=>row.selected===true)?.connection_alias||'';
    const alias=String(env.LOC_PUBLIC_DB_ALIAS||env.LOC_CONTROL_DB_ALIAS||
      env.LOC_MCP_DB_ALIAS||publishedAlias);
    const port=await database(env,alias);
    if(!port?.db||!['postgres','mysql','mssql'].includes(port.engine))
      return publishedResponse()||respond({error:'LOC native database unavailable'},503);
    const query=port.db;
    const relation=name=>portableRelation(name,port.engine,
      port.namespace||(port.engine==='postgres'?'silver':'dbo'));
    if(numeric)return respond({data:await (kind==='loc'?
      readLocGroupNumeric(query,start,end,port):readGalaxyNumeric(query,scope,kind,start,end,port))});
    if(kind==='config'){
      const columns=scopeConfigColumns(scope).split(',').filter(Boolean);
      // loc/lo3rwang/lrunes are three of the four fixed public ZModel control
      // relations (zenstack/policy-runtime.mjs). Route those through the real
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
            trx=>trx.selectFrom(modelName).select(columns)
              .where('id','=',scope).limit(1).executeTakeFirst())
        :await query.selectFrom(relation(scope))
            .select(columns).where('id','=',scope).limit(1).executeTakeFirst();
      return respond({data:row||null});
    }
    const table=relation(kind==='hero'?'loc_blocks':scope+'_blocks');
    const names=kind==='hero'?['group_'+feature,'scope_'+feature]:['index'];
    const data=await query.selectFrom(table).select(BLOCK_FIELDS)
      .where('page_name','in',names).orderBy('block_order','asc')
      .limit(100).execute();
    return respond({data});
  }catch(error){
    console.error('[LOC native public content] server database connection unavailable');
    if(!numeric){
      try{
        return respond({data:await publicPresentationFallback(kind,scope,feature,env)});
      }catch(fallbackError){
        console.error('[LOC native public content] public presentation fallback unavailable');
      }
    }
    return publishedResponse()||respond({error:'LOC native database unavailable'},503);
  }
}
