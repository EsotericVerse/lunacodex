// LOC-owned HTTPS ingress for the independent Deno SQL service.
// No Clerk, Supabase Function, Neon Auth or database Data API is used here.
import {DurableObject} from 'cloudflare:workers';

const REQUIRED=['LOC_CONTROL_DB_ALIAS','LOC_CONTROL_DB_ENGINE','LOC_DB_CONNECTIONS_JSON'];
const OPTIONAL=['LOC_AUTHORITY_ORIGIN','LOC_DELEGATION_NOT_BEFORE','LOC_DELEGATION_REVOKED_SIDS','LOC_SEARCH_INDEX_URL','LOC_SEARCH_INDEX_SECRET'];
function unavailable(message,status=503){
  return Response.json({error:{message}},{status,
    headers:{'cache-control':'no-store'}});
}
export class LocSqlContainer extends DurableObject {
  async ensureReady(){
    const container=this.ctx.container;
    if(!container.running){
      const environment={PORT:'8000'};
      for(const key of [...REQUIRED,...OPTIONAL]){
        if(this.env[key]!==undefined)environment[key]=String(this.env[key]);
      }
      container.start({image:container.images.base,instance:'lite',
        enableInternet:true,env:environment});
    }
    await container.setInactivityTimeout(300000);
    const port=container.getTcpPort(8000);
    for(let attempt=0;attempt<40;attempt++){
      try{
        const response=await port.fetch('http://container/health',{
          method:'GET',signal:AbortSignal.timeout(800)});
        await response.body?.cancel();
        if(response.status===204)return;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('LOC SQL Container did not become ready');
  }
  async fetch(request){
    try{
      if(!this.ready||!this.ctx.container.running){
        if(!this.starting)
          this.starting=this.ensureReady().finally(()=>{this.starting=null;});
        await this.starting;
        this.ready=true;
      }
      const url=new URL(request.url);
      // getTcpPort needs an internal HTTP origin, preserving signed headers/body.
      url.protocol='http:';
      url.host='container';
      const forwarded=new Request(url,request);
      forwarded.headers.delete('host');
      return await this.ctx.container.getTcpPort(8000).fetch(forwarded);
    }catch(error){
      this.ready=false;
      console.error(JSON.stringify({message:'LOC SQL Container ingress failed',
        error:error instanceof Error?error.message:'Unknown failure'}));
      return unavailable('LOC SQL Gateway unavailable');
    }
  }
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname!=='/v1/sql'||!['POST','OPTIONS'].includes(request.method))
      return unavailable('Not found',404);
    if(REQUIRED.some(name=>!env[name]))
      return unavailable('LOC SQL Gateway is not configured');
    // The canonical Deno handler verifies LOC Authority RS256 delegations.
    return env.LOC_SQL_CONTAINER.getByName('loc-main').fetch(request);
  }
};
