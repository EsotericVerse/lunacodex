// Browser-only secure Scope database configuration. Never send API credentials
// through MCP tool arguments, URLs, the SQL Gateway, or client-side storage.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const TABLE=/^[a-z][a-z0-9_]{0,62}$/;

export async function locAuthorityOrigin(){
  return 'https://auth.lo3rwang.cc';
}

export async function scopeConfigRequest({scopeid,token,values,fetchImpl=globalThis.fetch}={}){
  if(!SCOPE.test(String(scopeid||'')))throw new Error('Invalid Scope ID');
  if(typeof token!=='string'||!token.trim())throw new Error('LOC Auth login required');
  if(values!==undefined){
    if(!values||typeof values!=='object'||Array.isArray(values)||
      !TABLE.test(String(values.schema||''))||!TABLE.test(String(values.table||''))||
      typeof values.endpoint!=='string'||!values.endpoint.startsWith('https://'))
      throw new Error('An existing Galaxy table, schema and HTTPS SQL Gateway are required');
    if(Object.keys(values).some(key=>!['endpoint','schema','table'].includes(key)))
      throw new Error('Database credentials cannot be sent from the browser');
  }
  const authorityOrigin=await locAuthorityOrigin(fetchImpl);
  const response=await fetchImpl(authorityOrigin+'/v1/mcp/scope/'+scopeid,{
    method:values===undefined?'GET':'PUT',cache:'no-store',credentials:'omit',
    redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{authorization:'Bearer '+token,accept:'application/json',
      ...(values!==undefined?{'content-type':'application/json'}:{})},
    ...(values!==undefined?{body:JSON.stringify(values)}:{})
  });
  if(response.status===403)throw new Error('Scope Group authorization required');
  if(response.status===401)throw new Error('LOC Auth login expired');
  if(!response.ok)throw new Error('LOC Scope database service returned HTTP '+response.status);
  const result=await response.json();
  if(!result||typeof result!=='object'||Array.isArray(result))
    throw new Error('Invalid LOC Scope configuration response');
  return result;
}
