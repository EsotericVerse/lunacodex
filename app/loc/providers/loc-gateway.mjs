// LOC's only browser-facing SQL + delegated identity composition.
// Neither the authenticated identity source nor the SQL host is a vendor.
// The calling application supplies an independently verified token adapter.
import {createKyselyEdgeClient} from './kysely-edge.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';

export function createLocGatewayAdapter({
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  accountAdapter,
  gatewayUrl=process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'',
  publicGatewayUrl=gatewayUrl,
  url='',publishableKey='',
  target='configured',
  realtimeClient=null,
  fetchImpl=globalThis.fetch
}={}){
  const {auth,getAccessToken:externalAccessToken}=accountAdapter||{};
  if(!auth||typeof externalAccessToken!=='function')
    throw new Error('LOC Gateway requires an independently verified Auth adapter');
  const issuer=new URL('/v1/delegation',authorityUrl);
  if(issuer.protocol!=='https:'||issuer.username||issuer.password||
    issuer.search||issuer.hash)throw new Error('Invalid LOC delegation issuer');
  function delegationRequest(body={}){
    const kind=String(body.kind||'');
    if(kind==='status'||kind==='managed-action'&&[
      'manage_scope_registry','delete_scope','provision_scope',
      'loc_admin_settings','check_backup_readiness','connect_database_target'
    ].includes(String(body.name||'')))return {audience:'sql',global:true};
    if(kind==='managed-action'&&body.name==='manage'){
      const type=String(body.args?.p_type||'');
      if(type==='global')return {audience:'sql',global:true};
      if(type==='self')return {audience:'sql',self:true};
      const id=String(body.args?.p_id||'');
      return ['group','scope'].includes(type)&&/^[a-z][a-z0-9]{0,14}$/.test(id)
        ?{audience:'sql',scopeid:id,actions:['manage']}
        :{audience:'sql',identity:true};
    }
    // Authenticated Anchor readers must retain their editor Scope grant:
    // private keywords and invisible anchors are not returned to identity-only
    // tokens. Public readers already use the separate anonymous client.
    if(kind==='anchor'){
      const scope=String(body.scopeid||'');
      return /^[a-z][a-z0-9]{0,14}$/.test(scope)
        ?{audience:'sql',scopeid:scope,actions:['manage']}
        :{audience:'sql',identity:true};
    }
    const editing=kind==='managed-write'||kind==='managed-action'||
      kind==='query'&&body.operation!=='select'||
      kind==='anchor'&&!['read','catalog'].includes(String(body.attr?.op||'read'));
    if(!editing)return {audience:'sql',identity:true};
    const table=kind==='managed-write'?String(body.payload?.p_table||''):
      kind==='query'?String(body.table||''):'';
    if(table==='manage'||table==='loc'||table==='api.manage'||
       table==='silver.manage'||table==='silver.loc')
      return {audience:'sql',global:true};
    const scope=kind==='managed-action'?String(body.args?.p_scope_id||
      body.args?.scopeid||body.args?.p_group_id||''):
      kind==='anchor'?String(body.scopeid||''):
      String(table).replace(/^silver\./,'').match(/^([a-z][a-z0-9]{0,14})(?:_(?:galaxy|anchor|blocks|keywords|trace|time|galaxy_media))?$/)?.[1]||'';
    return /^[a-z][a-z0-9]{0,14}$/.test(scope)
      ?{audience:'sql',scopeid:scope,actions:['manage']}
      :{audience:'sql',identity:true};
  }
  // Cache per exact OAuth token + requested delegation; a sign-out or OAuth
  // account switch changes the source token and cannot inherit its grants.
  const delegationCache=new Map();
  async function getLocAccessToken(body){
    const oauthToken=String(await externalAccessToken()||'');
    if(!oauthToken)return '';
    const request=delegationRequest(body);
    const key=oauthToken+'|'+JSON.stringify(request);
    const cached=delegationCache.get(key);
    if(cached?.until>Date.now()+30_000)return cached.token;
    if(cached?.pending)return cached.pending;
    const pending=(async()=>{
      const response=await fetchImpl(issuer.href,{
        method:'POST',credentials:'omit',signal:AbortSignal.timeout(8000),
        headers:{authorization:'Bearer '+oauthToken,'content-type':'application/json'},
        body:JSON.stringify(request)
      });
      if(!response.ok)throw new Error('LOC delegation exchange rejected (HTTP '+response.status+')');
      const data=await response.json();
      const token=String(data?.access_token||'');
      const until=Number(data?.expires_at)*1000;
      if(token.split('.').length!==3||!Number.isFinite(until)||until<=Date.now()+30_000)
        throw new Error('LOC delegation issuer returned invalid credentials');
      delegationCache.set(key,{token,until});
      while(delegationCache.size>16)delegationCache.delete(delegationCache.keys().next().value);
      return token;
    })();
    delegationCache.set(key,{pending});
    try{return await pending}
    catch(error){if(delegationCache.get(key)?.pending===pending)delegationCache.delete(key);throw error}
  }

  const publicSql=createKyselyEdgeClient({
    url,publishableKey,role:'anon',target,gatewayUrl:publicGatewayUrl,fetch:fetchImpl
  });
  const privateSql=createKyselyEdgeClient({
    url,publishableKey,role:'authenticated',target,gatewayUrl,
    getAccessToken:getLocAccessToken,fetch:fetchImpl
  });
  return {
    publicClient:publicSql,authClient:privateSql,auth,
    configuredPublicClient:publicSql,backupPublicClient:null,
    realtimeClient,primarySourceLabel:'主要資料庫連線',backupSourceLabel:''
  };
}
