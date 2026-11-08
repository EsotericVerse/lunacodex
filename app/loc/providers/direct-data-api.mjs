// Emergency LOC public database read adapter: an existing, independently
// hosted Data API. No LOC SQL proxy, SDK, Edge Function or raw DB credentials.
// This is the public-read transport for the CURRENT static Pages deployment;
// the owner's own Web Server may use its configured SQL driver independently.
import {queryBatchSize} from '../db-contract.mjs';
import {withPublicReadBudget} from './kysely-read-budget.mjs';

const ID=/^[a-z_][a-z0-9_]*$/i;
const isSafe=x=>ID.test(x);
const assertId=x=>{if(!isSafe(String(x||'')))throw Error('Invalid column or table name');return x;};
function requiredApi(url){
  const value=String(url||'').trim().replace(/\/+$/,'');
  if(!value)throw Error('Public database Data API URL is not configured');
  const parsed=new URL(value);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)
    throw Error('Public database Data API must use a clean HTTPS endpoint');
  return value;
}
function encodedValue(value){
  if(value===null)return 'null';
  if(typeof value==='boolean'||typeof value==='number')return String(value);
  return String(value).replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function rawFilter(op,value){
  if(op==='in'){
    if(!Array.isArray(value)||value.length>500)throw Error('Invalid list filter');
    return 'in.('+value.map(v=>'"'+encodedValue(v).replace(/"/g,'\\"')+'"').join(',')+')';
  }
  if(op==='contains')return 'ilike.*'+String(value||'').replace(/[\\%_*]/g,'\\$&')+'*';
  if(!['eq','neq','gt','gte','lt','lte','like','ilike','is'].includes(op))
    throw Error('Unsupported Data API filter');
  return op+'.'+encodedValue(value);
}
function publishedGalaxy(table,columns,filters){
  // The existing LOC public read contract permits search visibility, and
  // list visibility only when returning article bodies.
  if(!/_galaxy$/.test(table)||filters.some(f=>f.column==='search'))return filters;
  const isContent=columns.includes('*')||columns.includes('content');
  // Culture is a separate public visibility flag, not a Search opt-in.
  if(filters.some(f=>f.column==='culture'&&String(f.value)==='true')&&!isContent)
    return filters;
  return [...filters,{column:'search',op:'eq',value:true},
    ...(isContent?[{column:'list',op:'eq',value:true}]:[])];
}
class Query{
  constructor(run,schema,table){
    this.run=run;this.schema=schema;this.table=assertId(table);
    this.columns=['*'];this.filters=[];this.orFilters=[];this.orders=[];
    this.offset=0;this.rowLimit=queryBatchSize('*');this.count=null;this.head=false;
    this.cardinality=null;this.signal=null;this.dbId='';
  }
  select(cols='*',options={}){
    this.columns=String(cols||'*').split(',').map(s=>s.trim()).filter(Boolean);
    this.rowLimit=queryBatchSize(this.columns);
    this.count=options.count||null;this.head=options.head===true;return this;
  }
  _f(column,op,value,negate=false){this.filters.push({column:assertId(column),op,value,negate});return this;}
  eq(c,v){return this._f(c,'eq',v)} neq(c,v){return this._f(c,'neq',v)}
  gt(c,v){return this._f(c,'gt',v)} gte(c,v){return this._f(c,'gte',v)}
  lt(c,v){return this._f(c,'lt',v)} lte(c,v){return this._f(c,'lte',v)}
  like(c,v){return this._f(c,'like',v)} ilike(c,v){return this._f(c,'ilike',v)}
  is(c,v){return this._f(c,'is',v)} in(c,v){return this._f(c,'in',v)}
  contains(c,v){return this._f(c,'contains',v)}
  not(c,op,v){return this._f(c,op,v,true)}
  or(expression){this.orFilters.push(String(expression));return this}
  order(column,{ascending=true}={}){this.orders.push({column:assertId(column),ascending});return this}
  limit(n){if(!Number.isInteger(n)||n<0||n>5000)throw Error('Invalid page limit');this.rowLimit=n;return this}
  range(a,b){if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<a)throw Error('Invalid row range');this.offset=a;return this.limit(b-a+1)}
  single(){this.cardinality='single';return this}
  maybeSingle(){this.cardinality='maybeSingle';return this}
  searchIndex(){return this}
  expectDatabase(id){this.dbId=String(id||'');return this}
  abortSignal(signal){this.signal=signal;return this}
  insert(){throw Error('Private database writes require the owner Web Server')}
  update(){throw Error('Private database writes require the owner Web Server')}
  upsert(){throw Error('Private database writes require the owner Web Server')}
  delete(){throw Error('Private database writes require the owner Web Server')}
  then(ok,fail){return this.run(this).then(ok,fail)}
}
function unsupported(){throw Error('This operation requires the database owner Web Server; LOC provides no SQL Gateway')}
export function createDirectDataApiClient({
  url,apiKey,role='anon',fetch:fetchImpl=globalThis.fetch
}={}){
  const base=requiredApi(url);
  if(typeof fetchImpl!=='function')throw Error('Data API requires fetch');
  const key=String(apiKey||'').trim();
  if(!key)throw Error('Public database API key is not configured');
  async function read(q){
    if(q.dbId)throw Error('A database-specific read requires that database owner endpoint');
    if(q.signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const columns=q.columns;
    if(columns.some(c=>c!=='*'&&!/^[a-z_][a-z0-9_]*(?:\([^)]*\))?$/i.test(c)))
      throw Error('Invalid Data API projection');
    const url=new URL(base+'/'+q.table);
    url.searchParams.set('select',columns.join(','));
    const filters=publishedGalaxy(q.table,columns,q.filters);
    for(const f of filters)url.searchParams.append(f.column,(f.negate?'not.':'')+rawFilter(f.op,f.value));
    for(const group of q.orFilters){
      if(group.length>4000||/[;\u0000-\u001f]/.test(group))throw Error('Invalid OR filter');
      url.searchParams.append('or','('+group+')');
    }
    if(q.orders.length)url.searchParams.set('order',q.orders.map(o=>o.column+'.'+(o.ascending?'asc':'desc')).join(','));
    url.searchParams.set('limit',String(q.rowLimit));
    if(q.offset)url.searchParams.set('offset',String(q.offset));
    const headers={apikey:key,'accept-profile':q.schema,accept:'application/json'};
    if(q.count)headers.prefer='count='+q.count;
    const timeout=AbortSignal.timeout(9000);
    const signal=q.signal?AbortSignal.any([q.signal,timeout]):timeout;
    const response=await fetchImpl(url.toString(),{method:q.head?'HEAD':'GET',headers,signal,credentials:'omit',cache:'no-store'});
    const payload=q.head?null:await response.json().catch(()=>null);
    if(!response.ok){
      if(response.status===406&&q.cardinality==='maybeSingle')
        return {data:null,error:null,count:0,status:response.status};
      const error=new Error(payload?.message||payload?.error||'Database read failed (HTTP '+response.status+')');
      error.status=response.status;throw error;
    }
    const countText=response.headers.get('content-range')||'';
    const parsed=countText.match(/\/(\d+)$/);
    const count=parsed?Number(parsed[1]):null;
    const list=Array.isArray(payload)?payload:payload==null?[]:[payload];
    if(q.cardinality==='single'&&list.length!==1)throw Error('Expected exactly one database record');
    return {data:q.head?null:q.cardinality?list[0]||null:list,error:null,count,status:response.status};
  }
  async function cultureAnalytics(args={}) {
    const view=String(args.p_view||'');
    if(!['culture_anchors','culture_density'].includes(view))
      throw Error('Unsupported public Culture operation');
    const scope=String(args.p_scope_id||'');
    const start=args.p_start==null?'':String(args.p_start);
    const end=args.p_end==null?'':String(args.p_end);
    if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||
      (view==='culture_density'&&(!/^\d{4}-\d{2}-\d{2}$/.test(start)||
        !/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)))
      throw Error('Invalid LOC Culture query');
    // Use the configured public Data API directly; never create another SQL
    // service, database alias, or authentication preflight for guest readers.
    if(view==='culture_anchors'){
      const q=new Query(read,'silver',scope+'_anchor');
      const {data}=await q.select('uid,type,title,attr')
        .in('type',['date','period','era']).eq('invisible',false).limit(5000);
      return {data:data.map(row=>({...row,attr:typeof row.attr==='string'
        ?JSON.parse(row.attr||'{}'):row.attr||{}})),error:null};
    }
    // Database-side grouped aggregate, not a browser-side article scan.
    const q=new Query(read,'silver',scope+'_galaxy');
    const {data}=await q.select('date,site,count()')
      .eq('culture',true).gte('date',start).lte('date',end)
      .order('date',{ascending:true}).limit(5000);
    return {data:data.map(row=>({
      day:String(row.date||'').slice(0,10),site:String(row.site||''),
      item_count:Number(row.count||0)
    })),error:null};
  }
  function execute(q){
    return role==='anon'?withPublicReadBudget(()=>read(q),q.signal):read(q);
  }
  return {
    role,
    schema(schema){
      assertId(schema);
      return {from(table){return new Query(execute,schema,table)},
        analytics:cultureAnalytics,managedWrite:unsupported,managedAction:unsupported,
        publicAction:unsupported,anchor:unsupported};
    },
    shortImport:unsupported,
    activeTarget:async()=>({data:{id:'primary'},error:null})
  };
}
