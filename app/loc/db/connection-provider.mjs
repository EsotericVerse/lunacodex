// LOC connection providers are independent from SQL Types and Kysely Dialects.
// A provider selects the network/hosting route only; the selected SQL Driver
// validates and consumes its connection configuration separately.
import {getCloudflareContext} from '@opennextjs/cloudflare';

function unavailable(message){
  return Object.assign(new Error(message),{
    code:'BACKEND_UNAVAILABLE',httpStatus:503
  });
}

export function isCloudflareWorkerRuntime(){
  return Boolean(process.versions?.workerd)||
    globalThis.navigator?.userAgent==='Cloudflare-Workers'||
    Boolean(globalThis.Cloudflare);
}

// Resolve a Hyperdrive binding without interpreting its SQL protocol.
// PostgreSQL/MySQL/T-SQL compatibility belongs to the selected Driver,
// never to the connection-provider selector.
export async function locHyperdriveBinding(env={},{
  requireBinding=isCloudflareWorkerRuntime(),
  getContext=getCloudflareContext
}={}){
  let binding=env?.LOC_HYPERDRIVE||null;
  if(!binding){
    let context;
    try{context=await getContext({async:true});}
    catch{
      if(requireBinding)
        throw unavailable('LOC Hyperdrive request context unavailable');
      return null;
    }
    binding=context?.env?.LOC_HYPERDRIVE||null;
  }
  if(!binding){
    if(requireBinding)
      throw unavailable('LOC_HYPERDRIVE binding unavailable in Cloudflare Worker');
    return null;
  }
  const uri=binding?.connectionString;
  let url;
  try{url=new URL(uri);}catch{throw unavailable('LOC Hyperdrive binding invalid');}
  if(!url.protocol||!url.hostname)
    throw unavailable('LOC Hyperdrive binding invalid');
  return uri;
}

// Selection is intentionally independent from engine, SQL Type and Dialect.
// forceDirect and forceHyperdrive are explicit preflight overrides;
// the persisted runtime setting is read by the caller after opening the
// candidate route, preserving the existing admin-switch verification flow.
export async function resolveLocConnectionProvider(env={},{
  forceDirect=false,
  forceHyperdrive=false,
  requireBinding=isCloudflareWorkerRuntime(),
  getContext=getCloudflareContext
}={}){
  if(typeof forceDirect!=='boolean'||typeof forceHyperdrive!=='boolean')
    throw unavailable('Invalid LOC connection provider selection');
  if(forceDirect&&forceHyperdrive)
    throw unavailable('Conflicting LOC connection mode request');
  const directOnly=env?.LOC_HYPERDRIVE_MODE==='direct';
  if(directOnly&&forceHyperdrive)
    throw unavailable('LOC Hyperdrive disabled by deployment configuration');
  if(forceDirect||directOnly)
    return Object.freeze({provider:'direct',connectionMode:'direct'});
  const connectionString=await locHyperdriveBinding(env,{
    requireBinding:forceHyperdrive||requireBinding,getContext
  });
  if(connectionString){
    return Object.freeze({
      provider:'hyperdrive',
      connectionMode:'hyperdrive',
      connectionString
    });
  }
  return Object.freeze({provider:'direct',connectionMode:'direct'});
}
