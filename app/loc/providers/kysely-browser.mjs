import {MAX_ROWS} from '../query/query-batch-size.mjs';
// One browser transport for LOC public reads. The existing Pages Function
// executes every bounded SELECT with the server-owned Kysely SQL dialect.
// LOC OAuth delegation is still mandatory for all mutations.
import {withPublicReadBudget} from './kysely-read-budget.mjs';
import {coalescePendingPublicRead} from '../query/inflight-public-read.mjs';
import {transientReadSignal,transientReadGeneration} from '../../../packages/zenstack/transient-read-epoch.mjs';

// Pending coalescing is per transport instance, never shared across an
// unrelated public client or a separately selected SQL target.
let nextPublicTransportId=0;
const IDENT=/^[A-Za-z_][A-Za-z0-9_]*$/;
const FIELD=value=>{
  const field=String(value||'');
  if(!IDENT.test(field))throw Error('Invalid LOC SQL field');
  return field;
};
function noWrite(){throw Error('Public Kysely reader is read only');}
class Query {
  constructor(read,schema,table,mutate=null){
    this.read=read;this.mutate=mutate;
    this.schema=FIELD(schema);this.table=FIELD(table);
    this.operation='select';this.values=null;this.conflict=null;
    this.columns=['*'];this.filters=[];this.orFilters=[];this.orders=[];
    this.offset=0;this.rowLimit=null;this.count=null;
    this.head=false;this.cardinality=null;this.signal=null;this.dbId='';
    this.returning=false;
  }
  select(fields='*',options={}){
    this.returning=true;
    this.columns=String(fields||'*').split(',').map(s=>s.trim()).filter(Boolean);
    // SQL projection alone has no implicit row-count ceiling.
    this.count=options.count||null;this.head=options.head===true;return this;
  }
  _filter(column,op,value,negate=false){
    this.filters.push({column:FIELD(column),op,value,negate});return this;
  }
  eq(c,v){return this._filter(c,'eq',v)}
  neq(c,v){return this._filter(c,'neq',v)}
  gt(c,v){return this._filter(c,'gt',v)}
  gte(c,v){return this._filter(c,'gte',v)}
  lt(c,v){return this._filter(c,'lt',v)}
  lte(c,v){return this._filter(c,'lte',v)}
  like(c,v){return this._filter(c,'like',v)}
  ilike(c,v){return this._filter(c,'ilike',v)}
  // Case-folded *equality*, never a SQL LIKE wildcard expression.
  ieq(c,v){return this._filter(c,'ieq',v)}
  is(c,v){return this._filter(c,'is',v)}
  in(c,v){return this._filter(c,'in',v)}
  contains(c,v){return this._filter(c,'contains',v)}
  not(c,op,v){return this._filter(c,op,v,true)}
  or(value){this.orFilters.push(String(value));return this}
  order(c,{ascending=true,nullsFirst}={}){
    this.orders.push({column:FIELD(c),ascending:Boolean(ascending),nullsFirst});return this;
  }
  limit(n){
    if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid LOC read limit');
    this.rowLimit=n;return this;
  }
  range(start,end){
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)
      throw Error('Invalid LOC read range');
    this.offset=start;return this.limit(end-start+1);
  }
  single(){this.cardinality='single';return this}
  maybeSingle(){this.cardinality='maybeSingle';return this}
  expectDatabase(id){this.dbId=String(id||'');return this}
  abortSignal(signal){this.signal=signal;return this}
  insert(rows){if(!this.mutate)return noWrite();this.operation='insert';this.values=rows;return this}
  update(values){if(!this.mutate)return noWrite();this.operation='update';this.values=values;return this}
  upsert(rows,options={}){if(!this.mutate)return noWrite();this.operation='upsert';this.values=rows;this.conflict=options;return this}
  delete(){if(!this.mutate)return noWrite();this.operation='delete';return this}
  then(ok,fail){return (this.operation==='select'?this.read(this):this.mutate(this)).then(ok,fail)}
}
export function createKyselyPublicClient({
  role='anon',fetch:fetchImpl=globalThis.fetch,mutate=null
}={}){
  if(typeof fetchImpl!=='function')throw Error('LOC Kysely fetch is unavailable');
  const transportId=++nextPublicTransportId;
  // Public reads share free capacity without fixed per-class allocations.
  // Auth and protected writes never enter this anonymous browser queue.
  const publicReadFetch=(url,options,signal,kind='normal')=>{
    // Keep the slot until its JSON body has been consumed. A fetch() promise
    // resolves on headers; freeing at that point can let large responses
    // accumulate in memory outside the scheduler's actual ownership.
    const perform=async()=>{
      const response=await fetchImpl(url,{...options,signal});
      const payload=await response.json().catch(()=>null);
      return {response,payload,status:response.status};
    };
    return role==='anon'?withPublicReadBudget(perform,signal,{kind}):perform();
  };
  // Deduplicate only concurrent anonymous requests of exactly the same
  // shape and route epoch. No completed HTTP no-store body is retained.
  // Explicit AbortSignals, identity and protected reads remain independent.
  const pendingPublic=(kind,args,perform,share=true)=>{
    if(role!=='anon'||!share)return perform();
    const key=JSON.stringify(['native-public',transportId,transientReadGeneration(),kind,args]);
    return key.length<=16000?coalescePendingPublicRead(key,perform):perform();
  };
  async function read(q){
    // Pre-queued public reads and actual browser fetch use the same route epoch.
    q.signal=transientReadSignal(q.signal);
    if(q.dbId)throw Error('Selected SQL database requires signed LOC delegation');
    if(q.signal?.aborted){const error=new Error('Request cancelled');
      error.name='AbortError';throw error;}
    const response=await fetchImpl('/api/loc-public-query',{
      method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
      headers:{accept:'application/json','content-type':'application/json'},
      body:JSON.stringify({schema:q.schema,table:q.table,columns:q.columns,
        filters:q.filters,orFilters:q.orFilters,orders:q.orders,
        limit:q.rowLimit,offset:q.offset,head:q.head,count:q.count,
        cardinality:q.cardinality}),
      signal:q.signal?AbortSignal.any([q.signal,AbortSignal.timeout(9000)]):
        AbortSignal.timeout(9000)
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok){
      const code=String(payload?.code||'');
      const stage=String(payload?.stage||'');
      const reason=String(payload?.reason||'');
      const error=new Error('LOC Kysely '+(stage||'read')+' failed (HTTP '+
        response.status+(code?', SQLSTATE '+code:'')+(reason?', '+reason:'')+')');
      error.status=response.status;error.code=code;error.stage=stage;
      error.reason=reason;throw error;
    }
    if(!payload||!Object.hasOwn(payload,'data'))
      throw Error('Invalid LOC Kysely read response');
    return {data:payload.data,error:null,count:payload.count??null,status:response.status};
  }
  async function analytics(args={}){
    const work=async()=>{
    const view=String(args.p_view||''),scope=String(args.p_scope_id||'');
    if(!['culture_anchors','culture_density','daily','daily_total','overview','earliest','totals','loc',
      'culture_list','trace_places','trace_territory','trace_daily','lane_daily','trace_keywords','shared_classes',
      'search_summary','keyword_catalog','keyword_summary'].includes(view))
      throw Error('Unsupported LOC analytics query');
    if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))
      throw Error('Invalid LOC analytics Scope');
    const start=String(args.p_start||''),end=String(args.p_end||'');
    const params=new URLSearchParams({kind:view,scope});
    if(start||end){params.set('start',start);params.set('end',end)}
    const fixedContent=new Set(['culture_anchors','culture_density','daily','daily_total',
      'overview','earliest','totals','loc']);
    const useContent=fixedContent.has(view);
    const requestSignal=AbortSignal.any([
      transientReadSignal(args.signal||null),AbortSignal.timeout(9000)
    ]);
    const {response,payload}=await publicReadFetch(useContent?'/api/loc-public-content?'+params:
      '/api/loc-public-query',{
      method:useContent?'GET':'POST',credentials:'omit',cache:'no-store',
      redirect:'error',
      headers:useContent?{accept:'application/json'}:
        {accept:'application/json','content-type':'application/json'},
      ...(useContent?{}:{body:JSON.stringify({kind:'transaction',operation:'analytics',args:{
        p_scope_id:scope,p_view:view,p_start:start||null,p_end:end||null,
        p_options:args.p_options||{}
      }})}),
      // No independent timer/queue. Admission and cancellation are handled
      // by the existing bounded public-read budget and requestSignal.
    },requestSignal,args.signal?'interactive':'normal');
    if(!response.ok){
      const error=new Error('LOC Kysely analytics '+String(payload?.stage||'read')+
        ' failed (HTTP '+response.status+
        (payload?.code?', SQLSTATE '+payload.code:'')+
        (payload?.reason?', '+payload.reason:'')+')');
      error.status=response.status;error.code=payload?.code;throw error;
    }
    if(!payload||!Object.hasOwn(payload,'data'))
      throw Error('Invalid LOC Kysely analytics response');
    return {data:payload.data,error:null,status:response.status};
    };
    return pendingPublic('analytics',{
      scope:args.p_scope_id,view:args.p_view,start:args.p_start,
      end:args.p_end,options:args.p_options
    },work,!args.signal);
  }
  async function publicAction(name,args={}){
    const work=async()=>{
    const requestSignal=AbortSignal.any([transientReadSignal(),AbortSignal.timeout(9000)]);
    const {response,payload}=await publicReadFetch('/api/loc-public-query',{
      method:'POST',credentials:name==='search_scope_trace_place_names'?'include':'omit',
      cache:'no-store',redirect:'error',
      headers:{accept:'application/json','content-type':'application/json'},
      body:JSON.stringify({kind:'transaction',operation:'action',name,args})
    },requestSignal);
    if(!response.ok){
      const error=new Error('LOC public action failed (HTTP '+response.status+
        (payload?.code?', SQLSTATE '+payload.code:'')+')');
      error.status=response.status;error.code=payload?.code;throw error;
    }
    if(!payload||!Object.hasOwn(payload,'data'))
      throw Error('Invalid LOC public action response');
    return {data:payload.data,error:null,count:payload.count??null,status:response.status};
    };
    return pendingPublic('public-action',{name,args},work);
  }
  async function write(q){
    if(role!=='authenticated'||!mutate)throw Error('LOC management grant required');
    if(['update','delete'].includes(q.operation)&&!q.filters.length)
      throw Error('Unfiltered LOC write denied');
    const rows=Array.isArray(q.values)?q.values:q.values?[q.values]:[];
    const payload={p_table:q.schema+'.'+q.table,p_operation:q.operation,
      p_rows:['insert','upsert'].includes(q.operation)?rows:null,
      p_values:q.operation==='update'?q.values:null,
      p_filters:q.filters.map(f=>({column:f.column,operator:f.op,value:f.value}))};
    const result=await mutate(payload);
    if(result?.error)throw Error(result.error.message||'LOC Kysely write failed');
    const count=Number(result?.data?.count??result?.count??0);
    if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid LOC write receipt');
    if(!q.returning||!count)return {data:[],error:null,count};
    if(q.operation==='delete')return {data:[],error:null,count};
    const idField=['uid','record_id','id'].find(field=>
      rows.length&&rows.every(row=>row[field]!==undefined&&row[field]!==null));
    const ids=idField?[...new Set(rows.map(row=>row[idField]))]:[];
    if(!ids.length)return {data:[],error:null,count};
    const follow=new Query(read,q.schema,q.table);
    follow.columns=q.columns;follow.rowLimit=ids.length;
    follow.in(idField,ids);
    try{const data=await read(follow);return {data:data.data||[],error:null,count}}
    catch(error){return {data:[],error:null,count,readError:String(error.message)}}
  }
  return {
    role,
    schema(schema){
      FIELD(schema);
      return {from(table){return new Query(q=>{
        const callerSignal=q.signal;
        const perform=()=>{
          q.signal=transientReadSignal(callerSignal);
          return role==='anon'
            ?withPublicReadBudget(()=>read(q),q.signal,{
              kind:q.cardinality?'interactive':'normal'
            })
            :read(q);
        };
        return pendingPublic('select',{
          schema:q.schema,table:q.table,columns:q.columns,
          filters:q.filters,orFilters:q.orFilters,orders:q.orders,
          limit:q.rowLimit,offset:q.offset,head:q.head,
          count:q.count,cardinality:q.cardinality
        },perform,!callerSignal&&!q.dbId);
      },schema,table,mutate?write:null)},
      analytics,managedWrite:noWrite,managedAction:noWrite,
      publicAction,anchor:noWrite};
    },
    shortImport:noWrite,
    activeTarget:async()=>({data:{id:'primary'},error:null})
  };
}
