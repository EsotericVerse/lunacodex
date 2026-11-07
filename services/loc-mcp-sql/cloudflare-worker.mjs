// Thin Cloudflare HTTPS proxy: all authorization and SQL stays in Deno.
import {DurableObject} from 'cloudflare:workers';

const needed=['LOC_DB_CONNECTIONS_JSON','LOC_MCP_DB_ENGINE','LOC_MCP_DB_ALIAS',
 'LOC_MCP_DB_NAMESPACE','LOC_AUTHORITY_ORIGIN'];
function unavailable(message,status=503){
 return new Response(JSON.stringify({error:{message}}),{status,
  headers:{'content-type':'application/json','cache-control':'no-store'}});
}
export class LocMcpSqlContainer extends DurableObject {
 async ensureReady(){
  const container=this.ctx.container;
  if(!container.running){
   const environment={PORT:'8000'};
   for(const key of needed)environment[key]=String(this.env[key]||'');
   for(const key of ['LOC_DELEGATION_NOT_BEFORE','LOC_DELEGATION_REVOKED_SIDS'])
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
   return unavailable('LOC MCP SQL Gateway unavailable');
  }
 }
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/v1/sql'||!['POST','OPTIONS'].includes(request.method))
   return unavailable('Not found',404);
  if(needed.some(name=>!env[name]))
   return unavailable('LOC MCP SQL Gateway is not configured');
  // The Deno handler verifies signed LOC Scope grants and website CORS.
  return env.LOC_MCP_SQL_CONTAINER.getByName('mcp-main').fetch(request);
 }
};
