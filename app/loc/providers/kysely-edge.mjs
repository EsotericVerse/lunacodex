import {queryBatchSize} from '../db-contract.mjs';
import {withPublicReadBudget} from './kysely-read-budget.mjs';

class KyselyQuery {
  constructor(execute,schema,table){this.executeRequest=execute;this.request={kind:'query',schema,table,operation:'select',columns:['*'],filters:[],or:[],orders:[],limit:queryBatchSize('*'),offset:0}}
  select(columns='*',options={}){this.request.columns=String(columns||'*').split(',').map(x=>x.trim()).filter(Boolean);this.request.limit=queryBatchSize(this.request.columns);this.request.count=options.count||null;this.request.head=options.head===true;if(this.request.operation!=='select')this.request.returning=true;return this}
  insert(values){this.request.operation='insert';this.request.values=values;return this}
  update(values){this.request.operation='update';this.request.values=values;return this}
  delete(){this.request.operation='delete';return this}
  upsert(values,options={}){this.request.operation='upsert';this.request.values=values;this.request.onConflict=String(options.onConflict||'').split(',').map(x=>x.trim()).filter(Boolean);this.request.ignoreDuplicates=options.ignoreDuplicates===true;return this}
  _filter(column,operator,value,negate=false){this.request.filters.push({column,operator,value,negate});return this}
  eq(column,value){return this._filter(column,'eq',value)}
  neq(column,value){return this._filter(column,'neq',value)}
  gt(column,value){return this._filter(column,'gt',value)}
  gte(column,value){return this._filter(column,'gte',value)}
  lt(column,value){return this._filter(column,'lt',value)}
  lte(column,value){return this._filter(column,'lte',value)}
  like(column,value){return this._filter(column,'like',value)}
  ilike(column,value){return this._filter(column,'ilike',value)}
  contains(column,value){return this._filter(column,'contains',value)}
  is(column,value){return this._filter(column,'is',value)}
  in(column,value){return this._filter(column,'in',value)}
  not(column,operator,value){return this._filter(column,operator,value,true)}
  or(expression){this.request.or.push(String(expression));return this}
  order(column,options={}){this.request.orders.push({column,ascending:options.ascending!==false});return this}
  limit(value){this.request.limit=value;return this}
  range(from,to){this.request.offset=from;this.request.limit=Math.max(0,to-from+1);return this}
  single(){this.request.single='single';return this}
  maybeSingle(){this.request.single='maybeSingle';return this}
  abortSignal(signal){this.signal=signal;return this}
  then(resolve,reject){return this.executeRequest(this.request,this.signal).then(resolve,reject)}
}

function abortedRequest(){
  const error=new Error('Request cancelled');
  error.name='AbortError';
  return error;
}

function parseContentRange(value){const match=String(value||'').match(/\/(\d+)$/);return match?Number(match[1]):null}

// A Kysely transport may be deployed on an independent trusted SQL Gateway.
// Browser callers supply an OAuth JWT, never raw PostgreSQL credentials.
export function createKyselyEdgeClient({auth=null,role='authenticated',
  target='configured',gatewayUrl='',getAccessToken=null,fetch:fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw new Error('Kysely transport requires fetch');
  const external=String(gatewayUrl||'').trim();
  if(!external)throw new Error('LOC SQL Gateway is not configured');
  const parsed=new URL(external);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)
    throw new Error('SQL Gateway endpoint must be an HTTPS URL without credentials or parameters');
  const endpoint=external.replace(/\/+$/,'');
  async function performRequest(body,signal=null){
    // A queued query can be cancelled before an HTTP request starts.
    if(signal?.aborted)throw abortedRequest();
    let token='';
    if(typeof getAccessToken==='function'){
      token=String(await getAccessToken(body)||'');
      if(role==='authenticated'&&!token)
        throw new Error('Authenticated SQL Gateway request requires an active session');
    }
    if(role==='authenticated'&&!token)
      throw new Error('Authenticated database request requires a verified session');
    const headers={'content-type':'application/json'};
    if(token)headers.authorization='Bearer '+token;
    const request={method:'POST',headers,credentials:'omit',
      // Short-import contract accepts exactly {kind,scopeid,batch}.
      // Its server-selected default target is trusted; a browser-provided
      // database target is not part of this write boundary.
      body:JSON.stringify(body.kind==='short-import'?body:{...body,target})};
    // Preserve the caller's cancellation while enforcing the transport deadline.
    // A stale Search/Culture request must stop its HTTP work, not just hide its result.
    if(signal?.aborted)throw abortedRequest();
    // User-triggered batched Galaxy writes may take longer than public reads.
    // Allow the database transaction to finish; never add hidden auth retries.
    const deadline=AbortSignal.timeout(body.kind==='short-import'?25000:9000);
    const requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
    const response=await fetchImpl(endpoint,{...request,signal:requestSignal});
    let payload=null;try{payload=await response.json()}catch{}
    if(!response.ok){const error=new Error(payload?.error?.message||payload?.message||`Kysely request failed (HTTP ${response.status})`);error.status=response.status;error.code=payload?.error?.code;error.details=payload?.error?.details;throw error}
    if(body.kind==='short-import')return payload;
    if(body.kind==='managed-write'||body.kind==='managed-action'||body.kind==='anchor'||body.kind==='analytics'||body.kind==='public-action')return {data:payload?.data??null,error:null,status:response.status};
    const count=payload?.count??parseContentRange(response.headers.get('content-range'));
    return {data:payload?.data??null,error:null,count,status:response.status};
  }
  function execute(body,signal=null){
    // All public readers on this browser tab share a small queue. Private
    // writes and management verification must never wait behind it.
    const publicRead=role==='anon'&&(
      body.kind==='analytics'||body.kind==='public-action'||body.kind==='anchor'||
      body.kind==='query'&&body.operation==='select'
    );
    return publicRead?withPublicReadBudget(()=>performRequest(body,signal),signal):performRequest(body,signal);
  }
  const client={
    schema(schema){return {from(table){return new KyselyQuery(execute,schema,table)},managedWrite(payload){return execute({kind:'managed-write',payload,target})},managedAction(name,args={}){return execute({kind:'managed-action',name,args,target})},anchor(scopeid,type,attr={}){return execute({kind:'anchor',scopeid,type,attr,target})},analytics(args){return execute({kind:'analytics',args,target})},publicAction(name,args={}){return execute({kind:'public-action',name,args,target})}}},

    auth:auth||null,
    shortImport(scopeid,batch){
      if(role!=='authenticated')throw new Error('Short import requires LOC website session');
      return execute({kind:'short-import',scopeid,batch});
    },
    activeTarget(){return execute({kind:'status',name:'active_public_target'});},
    role,target
  };
  return client;
}
