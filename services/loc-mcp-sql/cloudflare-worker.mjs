// Thin Cloudflare HTTPS proxy: all authorization and SQL stays in Deno.
import {DurableObject} from 'cloudflare:workers';

const containerEnv=['LOC_DB_CONNECTIONS_JSON','LOC_MCP_DB_ENGINE','LOC_MCP_DB_ALIAS',
 'LOC_MCP_DB_NAMESPACE','LOC_CONTROL_DB_ENGINE','LOC_CONTROL_DB_ALIAS',
 'LOC_AUTHORITY_ORIGIN','LOC_SQL_GATEWAY_SERVICE_KEY',
 'LOC_DELEGATION_NOT_BEFORE','LOC_DELEGATION_REVOKED_SIDS'];
const siteOrigin='https://loc.lo3rwang.cc';
const cors={'access-control-allow-origin':siteOrigin,
 'access-control-allow-methods':'POST, OPTIONS',
 'access-control-allow-headers':'Authorization, Content-Type',
 'access-control-max-age':'300','vary':'Origin'};
function unavailable(message,status=503,origin=''){
 return new Response(JSON.stringify({error:{message}}),{status,
  headers:{'content-type':'application/json','cache-control':'no-store',
   ...(origin===siteOrigin?{'access-control-allow-origin':siteOrigin,'vary':'Origin'}:{})}});
}
export class LocMcpSqlContainer extends DurableObject {
 async ensureReady(){
  const container=this.ctx.container;
  if(!container.running){
   const environment={PORT:'8000'};
   for(const key of containerEnv)
    if(this.env[key]!==undefined)environment[key]=String(this.env[key]);
   container.start({image:container.images.base,instance:'lite',
    enableInternet:true,env:environment});
  }
  await container.setInactivityTimeout(300000);
  const port=container.getTcpPort(8000);
  for(let attempt=0;attempt<40;attempt++){
   try{
    const check=await port.fetch('http://container/health',{
     method:'GET',signal:AbortSignal.timeout(800)});
    await check.body?.cancel();
    if(check.status===204)return;
   }catch{}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('MCP SQL container did not become ready');
 }
 async fetch(request){
  try{
   if(!this.ready||!this.ctx.container.running){
    if(!this.starting)this.starting=this.ensureReady().finally(()=>{this.starting=null;});
    await this.starting;
    this.ready=true;
   }
   // Container port fetchers must receive an internal HTTP origin, not the
   // external HTTPS Worker URL. Preserve path, method, body and auth headers.
   const url=new URL(request.url);
   url.protocol='http:';
   url.host='container';
   const forwarded=new Request(url,request);
   forwarded.headers.delete('host');
   return await this.ctx.container.getTcpPort(8000).fetch(forwarded);
  }catch{
   this.ready=false;
   return unavailable('LOC MCP SQL Gateway unavailable',503,
    request.headers.get('origin')||'');
  }
 }
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  const origin=request.headers.get('origin')||'';
  if(url.pathname!=='/v1/sql')return unavailable('Not found',404,origin);
  // Chrome website-bridge preflight must not need a running SQL Container.
  if(request.method==='OPTIONS')
   return origin===siteOrigin?new Response(null,{status:204,headers:cors}):
    new Response(null,{status:403});
  if(request.method!=='POST')return unavailable('Method not allowed',405,origin);
  if(!env.LOC_DB_CONNECTIONS_JSON)
   return unavailable('LOC MCP SQL Gateway is not configured',503,origin);
  // Only a trusted server alias may select a database; the Deno handler
  // verifies the exact alias, engine, LOC delegation and website CORS.
  return env.LOC_MCP_SQL_CONTAINER.getByName('mcp-main').fetch(request);
 }
};
