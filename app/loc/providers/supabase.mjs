import {createClient} from '@supabase/supabase-js';
import {createKyselyEdgeClient} from './kysely-edge.mjs';
import {selectedDatabaseRouting} from './routing-state.mjs';

const DEFAULT_SUPABASE_URL='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

// The primary Supabase must NEVER consume one direct PostgreSQL connection
// per browser read. Supabase's managed Data API gives us the same PostgREST
// query shape and RLS without exhausting the database's direct connection slots.
// Custom database target management uses trusted Kysely actions directly.

// Diagnostic: the browser has shown the SAME request (same table, same
// limit) sometimes carry `apikey` and sometimes not, with no code change in
// between -- which rules out anything in this module's static header setup
// (it's a plain constant). Wrap the fetch actually used for every Supabase
// request so the next time this happens, the console tells us exactly which
// URL went out with the header missing/empty, instead of guessing again.
function withApikeyDiagnostics(fetchImpl,publishableKey){
  if(typeof fetchImpl!=='function')return fetchImpl;
  return function diagnosedFetch(input,init){
    try{
      const headers=new Headers((init&&init.headers)||(input&&input.headers)||undefined);
      const sentKey=headers.get('apikey');
      const url=typeof input==='string'?input:input?.url;
      if(url&&/\/rest\/v1\//.test(url)&&(!sentKey||sentKey!==publishableKey)){
        console.warn('[supabase] apikey missing/mismatched on outgoing request',{url,sentKey,expectedKey:publishableKey?publishableKey.slice(0,12)+'…':'(none)'});
      }
    }catch(diagnosticError){
      console.warn('[supabase] apikey diagnostic failed to inspect request',diagnosticError);
    }
    return fetchImpl(input,init);
  };
}

export function createSupabaseAdapter({
  url=process.env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_SUPABASE_URL,
  publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  createClientImpl=createClient,
  fetchImpl=withApikeyDiagnostics(globalThis.fetch,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||DEFAULT_SUPABASE_PUBLISHABLE_KEY),
  target='configured'
}={}){
  if(!url||!publishableKey)throw new Error('Supabase requires a project URL and publishable key');
  const authenticatedSdk=createClientImpl(url,publishableKey,{
    db:{schema:'silver'},
    global:{fetch:fetchImpl},
    auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
  });
  const publicSdk=createClientImpl(url,publishableKey,{
    db:{schema:'silver'},
    global:{fetch:fetchImpl},
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false,storageKey:'loc-primary-public'}
  });
  // Default: existing Supabase function. A deployed standalone SQL Gateway
  // can replace only the Kysely transport, without moving the browser Auth UI.
  const gatewayUrl=process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'';
  const edgeAdmin=createKyselyEdgeClient({url,publishableKey,auth:authenticatedSdk.auth,target,gatewayUrl,fetch:fetchImpl});
  const edgePublic=createKyselyEdgeClient({url,publishableKey,role:'anon',target,gatewayUrl,fetch:fetchImpl});
  const publicRouting=edgePublic;
  // Explicit non-primary targets retain the portable Kysely transport.
  if(target!=='configured'&&target!=='supabase'){
    return {publicClient:edgePublic,authClient:edgeAdmin,auth:authenticatedSdk.auth};
  }
  function routedWrite(schema,table,method,args){
    const steps=[];
    const execute=async()=>{
      const selection=await selectedDatabaseRouting(publicRouting);
      if(!selection.verified)throw new Error('Primary database cannot be confirmed; write cancelled');
      if(selection.provider==='neon')throw new Error('Selected primary database is read-only');
      const source=(schema==='api'||!selection.primaryControl)?edgeAdmin.schema(schema):authenticatedSdk.schema(schema);
      let query=source.from(table)[method](...args);
      for(const [name,values] of steps)query=query[name](...values);
      return await query;
    };
    const chain=new Proxy({},{
      get(_target,key){
        if(key==='then')return (resolve,reject)=>execute().then(resolve,reject);
        if(key==='catch')return reject=>execute().catch(reject);
        if(key==='finally')return done=>execute().finally(done);
        return (...values)=>{steps.push([key,values]);return chain};
      }
    });
    return chain;
  }
  function authenticatedDatabase(schema){
    // The 'api' schema is private (not exposed to PostgREST). Route only its
    // authenticated, owner-RLS-protected records through the existing Edge SQL port.
    const db=schema==='api'?edgeAdmin.schema(schema):authenticatedSdk.schema(schema);
    return {
      from(table){
        const base=db.from(table);
        return new Proxy(base,{
          get(source,name,receiver){
            if(['insert','update','delete','upsert'].includes(name)){
              return (...args)=>routedWrite(schema,table,name,args);
            }
            const value=Reflect.get(source,name,receiver);
            return typeof value==='function'?value.bind(source):value;
          }
        });
      },
      analytics(args){return edgeAdmin.schema(schema).analytics(args);},
      publicAction(name,args={}){return edgeAdmin.schema(schema).publicAction(name,args);},
      managedWrite(payload){return edgeAdmin.schema(schema).managedWrite(payload);},
      managedAction(name,args={}){return edgeAdmin.schema(schema).managedAction(name,args);}

    };
  }
  const authClient={
    schema:authenticatedDatabase,
    auth:authenticatedSdk.auth
  };
  return {publicClient:edgePublic,realtimeClient:publicSdk,configuredPublicClient:publicRouting,authClient,auth:authenticatedSdk.auth};
}
