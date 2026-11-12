// Per-LOC-subject, per-provider, per-tool governance.
// Only the dedicated browser approval path executes operations requiring consent.
import {UPSTREAM_PROVIDERS,upstreamProvider,providerToolName,providerArguments,
  policyMode,publicProviderStatus} from './upstream-providers.mjs';
import {providerKey,pendingPrefix,randomValue,vaultGet,vaultPut,vaultDelete,
  vaultList,hashValue,providerStoreReady} from './upstream-vault.mjs';
import {listUpstreamTools,invokeUpstreamTool} from './upstream-tools.mjs';
const PENDING_TTL=900;
const RECEIPT_TTL=3600;
async function policyKey(subject,provider){
  upstreamProvider(provider);return 'policy:'+await hashValue(subject)+':'+provider;
}
async function policies(env,subject,provider){
  return await vaultGet(env,await policyKey(subject,provider))||{};
}
export async function providerStatuses(env,subject){
  if(!providerStoreReady(env))
    return {ready:false,providers:Object.entries(UPSTREAM_PROVIDERS)
      .map(([id,p])=>({id,label:p.label,connected:false,policies:{}}))};
  const providers=[];
  for(const id of Object.keys(UPSTREAM_PROVIDERS)){
    const link=await vaultGet(env,await providerKey(subject,id));
    providers.push(publicProviderStatus(id,link,await policies(env,subject,id)));
  }
  return {ready:true,providers};
}
export async function setToolPolicy(env,subject,provider,tool,mode){
  providerToolName(tool);policyMode(mode);upstreamProvider(provider);
  // Policy can only be configured for tools advertised by this provider.
  const names=(await listUpstreamTools(env,subject,provider)).map(item=>item.name);
  if(!names.includes(tool))throw new Error('Tool is not advertised by the connected provider');
  const key=await policyKey(subject,provider);
  const old=await policies(env,subject,provider);
  old[tool]=mode;
  if(Object.keys(old).length>350)throw new Error('Too many configured MCP tools');
  await vaultPut(env,key,old);
  return {provider,tool,mode};
}
export async function clearToolPolicies(env,subject,provider){
  const key=await policyKey(subject,provider);
  await vaultDelete(env,key);
  const prefix=await pendingPrefix(subject);
  for(const id of await vaultList(env,prefix,100)){
    const pending=await vaultGet(env,id);
    if(pending?.provider===provider)await vaultDelete(env,id);
  }
}
export async function requestTool(env,subject,provider,tool,args){
  upstreamProvider(provider);providerToolName(tool);
  args=providerArguments(args);
  const linked=await vaultGet(env,await providerKey(subject,provider));
  if(!linked)throw new Error('Provider OAuth authorization required');
  const mode=(await policies(env,subject,provider))[tool]||'deny';
  if(mode==='deny')return {status:'denied',provider,tool};
  if(mode==='auto')return {status:'executed',provider,tool,
    result:await invokeUpstreamTool(env,subject,provider,tool,args)};
  const id=randomValue(24);
  const key=await pendingPrefix(subject)+id;
  await vaultPut(env,key,{subject,provider,tool,args,created_at:Date.now(),
    expires_at:Date.now()+PENDING_TTL*1000},PENDING_TTL);
  return {status:'approval_required',provider,tool,approval_id:id,
    message:'This tool requires a fresh human approval in LOC Admin → MCP Providers.'};
}
export async function pendingApprovals(env,subject){
  const prefix=await pendingPrefix(subject);
  const result=[];
  for(const key of await vaultList(env,prefix,30)){
    const item=await vaultGet(env,key);
    if(!item||item.subject!==subject||item.expires_at<Date.now())continue;
    result.push({id:key.slice(prefix.length),provider:item.provider,
      tool:item.tool,args:item.args,created_at:item.created_at,
      expires_at:item.expires_at});
  }
  return result;
}
export async function decideApproval(env,subject,id,accept){
  if(!/^[A-Za-z0-9_-]{25,64}$/.test(id))throw new Error('Invalid approval ID');
  const key=await pendingPrefix(subject)+id;
  const item=await vaultGet(env,key);
  if(!item||item.subject!==subject||item.expires_at<Date.now())
    throw new Error('Approval expired or not found');
  // Remove pending first: failure cannot accidentally repeat a side effect.
  // Cloudflare KV is eventually consistent; this is not a globally atomic
  // exactly-once guarantee. Providers must enforce their own idempotency.
  await vaultDelete(env,key);
  const receiptKey='receipt:'+await hashValue(subject)+':'+id;
  if(!accept){
    await vaultPut(env,receiptKey,{status:'rejected'},RECEIPT_TTL);
    return {status:'rejected'};
  }
  if((await policies(env,subject,item.provider))[item.tool]!=='ask')
    throw new Error('Function approval policy changed; request again');
  try{
    const result=await invokeUpstreamTool(env,subject,item.provider,item.tool,item.args);
    await vaultPut(env,receiptKey,{status:'executed',result},RECEIPT_TTL);
    return {status:'executed',result};
  }catch(error){
    await vaultPut(env,receiptKey,{status:'failed',reason:'Provider execution failed'},RECEIPT_TTL);
    throw error;
  }
}
export async function approvalReceipt(env,subject,id){
  if(!/^[A-Za-z0-9_-]{25,64}$/.test(id))throw new Error('Invalid approval ID');
  return await vaultGet(env,'receipt:'+await hashValue(subject)+':'+id)||
    {status:'pending_or_expired'};
}
