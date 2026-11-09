// Emergency LOC public database read adapter: an existing, independently
// hosted Data API. No LOC SQL proxy, SDK, Edge Function or raw DB credentials.
// This is the public-read transport for the CURRENT static Pages deployment;
// the owner's own Web Server may use its configured SQL driver independently.
import {queryBatchSize} from '../db-contract.mjs';
import {parsePortableOrExpression} from './portable-search.mjs';
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
// The existing public Data API accepts ILIKE, not Kysely's virtual
// 'contains' predicate. Keep the transport's literal/compound search
// semantics without sending an unsupported PostgREST operator.
function dataApiOrExpression(expression){
  const raw=String(expression);
  if(!raw.includes('.contains.'))return raw;
  const parsed=parsePortableOrExpression(raw);
  const render=node=>{
    if(node.type==='or'||node.type==='and')
      return node.type+'('+node.items.map(render).join(',')+')';
    if(node.type!=='predicate')throw Error('Invalid Data API OR predicate');
    if(node.operator==='contains'){
      const term=String(node.value).replace(/[\\%_*]/g,ch=>'\\'+ch);
      return node.column+'.ilike.'+JSON.stringify('*'+term+'*');
    }
    const value=typeof node.value==='string'?JSON.stringify(node.value):String(node.value);
    return node.column+'.'+node.operator+'.'+value;
  };
  return parsed.items.map(render).join(',');
}
class Query{
  constructor(run,schema,table,mutate=null){
    this.run=run;this.mutate=mutate;this.operation='select';this.values=null;
    this.returning=false;this.conflict=null;
    this.schema=schema;this.table=assertId(table);
    this.columns=['*'];this.filters=[];this.orFilters=[];this.orders=[];
    this.offset=0;this.rowLimit=queryBatchSize('*');this.count=null;this.head=false;
    this.cardinality=null;this.signal=null;this.dbId='';
  }
  select(cols='*',options={}){
    this.returning=true;
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
  or(expression){this.orFilters.push(dataApiOrExpression(expression));return this}
  order(column,{ascending=true}={}){this.orders.push({column:assertId(column),ascending});return this}
  limit(n){if(!Number.isInteger(n)||n<0||n>5000)throw Error('Invalid page limit');this.rowLimit=n;return this}
  range(a,b){if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<a)throw Error('Invalid row range');this.offset=a;return this.limit(b-a+1)}
  single(){this.cardinality='single';return this}
  maybeSingle(){this.cardinality='maybeSingle';return this}
  searchIndex(){return this}
  expectDatabase(id){this.dbId=String(id||'');return this}
  abortSignal(signal){this.signal=signal;return this}
  insert(rows){if(!this.mutate)throw Error('Private database writes require the owner Web Server');this.operation='insert';this.values=rows;return this}
  update(values){if(!this.mutate)throw Error('Private database writes require the owner Web Server');this.operation='update';this.values=values;return this}
  upsert(rows,options={}){if(!this.mutate)throw Error('Private database writes require the owner Web Server');this.operation='upsert';this.values=rows;this.conflict=options;return this}
  delete(){if(!this.mutate)throw Error('Private database writes require the owner Web Server');this.operation='delete';return this}
  then(ok,fail){return (this.operation==='select'?this.run(this):this.mutate(this)).then(ok,fail)}
}
function unsupported(){throw Error('This operation requires the database owner Web Server; LOC provides no SQL Gateway')}
export function createDirectDataApiClient({
  url,apiKey,role='anon',fetch:fetchImpl=globalThis.fetch,mutate=null
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
    const filters=q.filters;
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
  async function publicAnalytics(args={}) {
    const view=String(args.p_view||'');
    const supported=['culture_anchors','culture_density','daily','overview','earliest','totals','loc'];
    if(!supported.includes(view))throw Error('Unsupported public aggregation operation');
    const scope=String(args.p_scope_id||'');
    const start=args.p_start==null?'':String(args.p_start);
    const end=args.p_end==null?'':String(args.p_end);
    const dated=view!=='culture_anchors'&&view!=='earliest'&&view!=='totals'&&view!=='loc';
    if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||
      (dated&&(!/^\d{4}-\d{2}-\d{2}$/.test(start)||
        !/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end))||
      (view==='earliest'&&(start||end))||
      ((view==='totals'||view==='loc')&&(Boolean(start)!==Boolean(end)||
        start&&(!/^\d{4}-\d{2}-\d{2}$/.test(start)||
          !/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end))))
      throw Error('Invalid LOC public aggregation query');
    if(view==='culture_anchors'){
      // Anchor is a simple bounded public SELECT. No business aggregate or
      // separate server round trip is necessary for the first Culture river.
      const q=new Query(read,'silver',scope+'_anchor');
      const {data}=await q.select('uid,type,title,attr')
        .in('type',['date','period','era']).eq('invisible',false).limit(5000);
      return {data:data.map(row=>({...row,attr:typeof row.attr==='string'
        ?JSON.parse(row.attr||'{}'):row.attr||{}})),error:null};
    }
    // The STATIC browser must not emit PostgREST count() / GROUP BY, which
    // the public Data API rejects. Fixed native Galaxy aggregation executes
    // inside the already-existing Pages Kysely application.
    const params=new URLSearchParams({kind:view,scope});
    if(start){params.set('start',start);params.set('end',end);}
    const response=await fetchImpl('/api/loc-public-content?'+params.toString(),{
      method:'GET',credentials:'omit',cache:'no-store',
      signal:AbortSignal.timeout(9000),headers:{accept:'application/json'}
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(payload?.error||'Native LOC Galaxy aggregate unavailable (HTTP '+response.status+')');
      error.status=response.status;
      throw error;
    }
    if(!payload||!Object.hasOwn(payload,'data'))
      throw Error('Invalid LOC Galaxy aggregate response');
    return {data:payload.data,error:null,status:response.status};
  }
  function execute(q){
    return role==='anon'?withPublicReadBudget(()=>read(q),q.signal):read(q);
  }
  async function write(q){
    if(role!=='authenticated'||typeof mutate!=='function')
      throw Error('LOC Auth management write is not configured');
    if(q.filters.some(f=>f.negate||!['eq','neq','gt','gte','lt','lte','like','ilike','is','in'].includes(f.op)))
      throw Error('Unsupported managed write filter');
    const rows=Array.isArray(q.values)?q.values:q.values?[q.values]:[];
    const filters=q.filters.map(f=>({column:f.column,operator:f.op,value:f.value}));
    if(['update','delete'].includes(q.operation)&&!filters.length)
      throw Error('Unfiltered database mutation denied');
    const payload={p_table:q.schema+'.'+q.table,p_operation:q.operation,
      p_rows:['insert','upsert'].includes(q.operation)?rows:null,
      p_values:q.operation==='update'?q.values:null,
      p_filters:filters};
    const before=q.returning&&q.operation==='delete'?(await read(q)).data:[];
    const result=await mutate(payload);
    if(result?.error)throw Error(result.error.message||'LOC management write failed');
    const count=Number(result?.data?.count??result?.count??0);
    if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid LOC write receipt');
    if(!q.returning||!count)return {data:[],error:null,count};
    if(q.operation==='delete')return {data:(before||[]).slice(0,count),error:null,count};
    // Preserve the caller's narrow, already validated lookup filters on UPDATE.
    // INSERT/UPSERT return by their explicit stable primary key. If the
    // follow-up read fails after the database committed, do not pretend the
    // mutation itself failed (the caller still receives its committed count).
    const idField=['uid','record_id','id'].find(field=>
      rows.length&&rows.every(row=>row[field]!==undefined&&row[field]!==null));
    const ids=idField?[...new Set(rows.map(row=>row[idField]))]:[];
    const follow=new Query(read,q.schema,q.table);
    follow.columns=q.columns;
    follow.filters=ids.length?
      [{column:idField,op:'in',value:ids,negate:false}]:
      [...q.filters];
    if(!follow.filters.length)return {data:[],error:null,count};
    follow.rowLimit=Math.min(5000,Math.max(count,ids.length,1));
    try{
      const response=await read(follow);
      return {data:response.data||[],error:null,count};
    }catch(error){
      return {data:[],error:null,count,readError:String(error?.message||error)};
    }
  }
  return {
    role,
    schema(schema){
      assertId(schema);
      return {from(table){return new Query(execute,schema,table,mutate?write:null)},
        analytics:publicAnalytics,managedWrite:unsupported,managedAction:unsupported,
        publicAction:unsupported,anchor:unsupported};
    },
    shortImport:unsupported,
    activeTarget:async()=>({data:{id:'primary'},error:null})
  };
}
