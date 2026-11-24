'use server';
import {withPublicLocRead} from '../read-context.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {sharedClasses,keywordCatalog,keywordSummary}
  from '../../providers/kysely-analytics.mjs';
import {SCOPE_ROUTE_INDEX} from '../../../modular/routing/scope-route-index.js';
import {scopeFeatureEnabled} from '../../scope/scope-config-fields.mjs';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const KINDS=new Set(['daily','daily_total','overview','earliest','totals','loc']);
const active=new Map(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false)
  .map(row=>[row.scope_id,row]));
const valueDay=value=>value instanceof Date?value.toISOString().slice(0,10):
  String(value??'').slice(0,10);
const count=value=>Number(value)||0;
const scopeId=value=>{
  const scope=String(value||'').trim().toLowerCase();
  if(!active.has(scope)||scope==='admin')throw Error('Invalid Statistics Scope');
  return scope;
};
const rangeDate=value=>{
  if(value==null||value==='')return '';
  const day=String(value);
  if(!DAY.test(day))throw Error('Invalid Statistics date');
  return day;
};
const relation=(scope,suffix,port)=>portableRelation(scope+'_'+suffix,
  port.engine,port.namespace||(port.engine==='postgres'?'silver':'dbo'));

export async function queryStatics(args={}){
  const scope=scopeId(args.p_scope_id),view=String(args.p_view||'');
  const start=rangeDate(args.p_start),end=rangeDate(args.p_end);
  const options=args.p_options??{};
  if(!['shared_classes','keyword_catalog','keyword_summary'].includes(view)||
    !options||typeof options!=='object'||Array.isArray(options)||
    Object.keys(options).some(key=>!['classUid','source'].includes(key))||
    start&&end&&start>end)throw Error('Invalid Keyword query');
  if(!scopeFeatureEnabled(active.get(scope)?.config,'statistics_able'))
    throw Error('Statistics feature is not published');
  return withPublicLocRead({scope},async(db)=>{
    const anchor='silver.'+scope+'_anchor';
    let data;
    if(view==='shared_classes')
      data=await sharedClasses(db,scope,anchor,'anon');
    else if(view==='keyword_catalog')
      data=await keywordCatalog(db,scope,anchor,options.classUid||null,
        'anon');
    else data=await keywordSummary(db,scope,anchor,start||null,end||null,
      options.source||null,options.classUid||null,'anon');
    return {data,count:null};
  });
}

async function scopeStatistics(db,scope,kind,start,end,port){
  const table=relation(scope,'galaxy',port);
  if(kind==='earliest'){
    const first=await db.selectFrom(table)
      .select(eb=>eb.fn.min('date').as('earliest'))
      .where('statics','=',true).where('date','is not',null).executeTakeFirst();
    return valueDay(first?.earliest)||'';
  }
  if(kind==='totals'){
    let query=db.selectFrom(table).select('site')
      .select(eb=>eb.fn.countAll().as('item_count'))
      .where('statics','=',true).where('date','is not',null);
    if(start)query=query.where('date','>=',start);
    if(end)query=query.where('date','<=',end);
    const rows=await query.groupBy('site').orderBy('site','asc').execute();
    return rows.map(row=>({kind:'source',category:String(row.site||''),
      item_count:count(row.item_count)}));
  }
  if(kind==='daily_total'){
    const [rows,first]=await Promise.all([
      db.selectFrom(table).select('date')
        .select(eb=>eb.fn.countAll().as('item_count'))
        .where('statics','=',true).where('date','is not',null)
        .where('date','>=',start).where('date','<=',end)
        .groupBy('date').orderBy('date','asc').execute(),
      db.selectFrom(table).select(eb=>eb.fn.min('date').as('earliest'))
        .where('statics','=',true).executeTakeFirst()
    ]);
    return {earliest:valueDay(first?.earliest)||'',rows:rows.map(row=>({
      day:valueDay(row.date),item_count:count(row.item_count)
    }))};
  }
  const daily=db.selectFrom(table).select(['date','site'])
    .select(eb=>eb.fn.countAll().as('item_count'))
    .where('statics','=',true).where('date','is not',null)
    .where('date','>=',start).where('date','<=',end)
    .groupBy(['date','site']).orderBy('date','asc');
  const [grouped,first]=await Promise.all([
    daily.execute(),
    kind==='overview'?db.selectFrom(table)
      .select(eb=>eb.fn.min('date').as('earliest'))
      .where('statics','=',true).executeTakeFirst():Promise.resolve(null)
  ]);
  const totals=new Map(),rows=[];
  for(const row of grouped){
    const day=valueDay(row.date),item_count=count(row.item_count);
    rows.push({day,kind:'source',category:String(row.site||''),item_count});
    totals.set(day,(totals.get(day)||0)+item_count);
  }
  rows.push(...[...totals].map(([day,item_count])=>({
    day,kind:'total',category:'文字作品',item_count
  })));
  rows.sort((a,b)=>a.day.localeCompare(b.day)||a.kind.localeCompare(b.kind)||
    a.category.localeCompare(b.category));
  return kind==='overview'?{earliest:valueDay(first?.earliest)||'',rows,
    categories:[],aliases:[]}:rows;
}

async function locStatistics(db,start,end,port){
  const entries=SCOPE_ROUTE_INDEX.filter(row=>row.scope_id!=='loc'&&
    row.scope_id!=='admin'&&row.active!==false&&
    scopeFeatureEnabled(row.config,'statistics_able'));
  const results=await Promise.all(entries.map(async entry=>{
    const scope=entry.scope_id,table=relation(scope,'galaxy',port);
    const daily=db.selectFrom(table).select('date')
      .select(eb=>eb.fn.countAll().as('item_count'))
      .where('statics','=',true).where('date','is not',null)
      .where('date','>=',start||'0001-01-01')
      .where('date','<=',end||'9999-12-31')
      .groupBy('date').orderBy('date','asc');
    const [rows,first]=await Promise.all([daily.execute(),
      db.selectFrom(table).select(eb=>eb.fn.min('date').as('earliest'))
        .where('statics','=',true).executeTakeFirst()]);
    return {scope,display_name:String(entry.config?.display_name||scope),rows,first};
  }));
  let earliest='';
  const scopes=[],rows=[];
  for(const result of results){
    scopes.push({scope_id:result.scope,display_name:result.display_name});
    const first=valueDay(result.first?.earliest);
    if(first&&(!earliest||first<earliest))earliest=first;
    rows.push(...result.rows.map(row=>({scope_id:result.scope,
      day:valueDay(row.date),item_count:count(row.item_count)})));
  }
  return {earliest,scopes,rows};
}

export async function queryStaticsContent(searchParams){
  const params=new URLSearchParams(String(searchParams||''));
  const kind=String(params.get('kind')||''),scope=scopeId(params.get('scope'));
  const keys=[...params.keys()];
  if(!KINDS.has(kind)||keys.some(key=>!['kind','scope','start','end'].includes(key)))
    throw Error('Invalid Statistics query');
  const start=rangeDate(params.get('start')),end=rangeDate(params.get('end'));
  if(start&&end&&start>end||
    ['daily','daily_total','overview'].includes(kind)&&(!start||!end)||
    ['earliest','totals','loc'].includes(kind)&&Boolean(start)!==Boolean(end))
    throw Error('Invalid Statistics query range');
  if(kind==='loc'&&scope!=='loc'||kind!=='loc'&&scope==='loc')
    throw Error('Invalid Statistics query Scope');
  const config=active.get(scope)?.config;
  if(!scopeFeatureEnabled(config,'statistics_able'))
    throw Error('Statistics feature is not published');
  if(kind==='loc')return withPublicLocRead({scope:'loc'},async(db,port)=>({
    data:await locStatistics(db,start,end,port),count:null
  }));
  return withPublicLocRead({scope},async(db,port)=>({
    data:await scopeStatistics(db,scope,kind,start,end,port),count:null
  }));
}
