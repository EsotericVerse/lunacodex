// LOC MCP business data actions. Authentication belongs to Better Auth;
// writing and scope roles belong to the existing Neon api.manage table.
const API='https://mcp.lo3rwang.cc/api/loc-native';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const PR=/(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i;
function invalid(message){
  return Object.assign(new Error(message),{code:'INVALID_ARGUMENT',httpStatus:400});
}
export async function businessAction(name,args,token,env={},fetchImpl=globalThis.fetch){
  if(typeof token!=='string'||!token)
    throw invalid('LOC OAuth bearer token required');
  const a=args||{};
  const scope=String(a.scopeid||'');
  if(!SCOPE.test(scope))throw invalid('Invalid LOC Scope');
  let payload;
  if(name==='scope_storage'){
    if(Object.keys(a).some(key=>key!=='scopeid'))
      throw invalid('Only a LOC Scope identifier is accepted');
    payload={kind:'mcp-scope-status',scopeid:scope};
  }else if(name==='galaxy_link'){
    if(!['check','record'].includes(a.action))
      throw invalid('Unsupported Galaxy Link action');
    if(a.source!==undefined)throw invalid('Galaxy Link source is fixed to mcp');
    if(typeof a.conversation_id!=='string'||!a.conversation_id||
      typeof a.updated_at!=='string'||!Number.isFinite(Date.parse(a.updated_at)))
      throw invalid('Valid conversation_id and updated_at required');
    if(a.action==='record'){
      if(PR.test(String(a.title||'')))throw invalid('PR records must use GitHub');
      if(!Array.isArray(a.records)||!a.records.length||a.records.length>100)
        throw invalid('Source records required');
    }
    payload={kind:'mcp-conversation',scopeid:scope,action:a.action,
      conversation_id:a.conversation_id,updated_at:a.updated_at,
      ...(a.action==='record'?{created_at:a.created_at,
        title:a.title||'',records:a.records}:{}),
    };
  }else{
    throw invalid('Obsolete Auth-owned MCP action is not supported');
  }
  const reply=await fetchImpl(API,{method:'POST',redirect:'error',cache:'no-store',
    headers:{authorization:'Bearer '+token,'content-type':'application/json',
      accept:'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  const data=await reply.json().catch(()=>null);
  if(!reply.ok){
    const error=new Error(reply.status>=500?'LOC data service unavailable':
      String(data?.error?.message||'LOC business permission denied'));
    error.httpStatus=reply.status;
    throw error;
  }
  return data?.data||{};
}
