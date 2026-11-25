import {DurableObject} from 'cloudflare:workers';
import {COMPUTE_PROTOCOL} from '../app/loc/compute/contract.mjs';

// Private DO binding only. No public route is added to the LOC Worker.
export class LocCompute extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    if(ctx.container?.running)
      void ctx.blockConcurrencyWhile(()=>ctx.container.setInactivityTimeout(60000));
  }
  async ready(){
    const container=this.ctx.container;
    if(!container)throw Error('LOC Container unavailable');
    if(!container.running)container.start({enableInternet:false});
    await container.setInactivityTimeout(60000);
    const port=container.getTcpPort(8080);
    const deadline=Date.now()+25000;
    while(Date.now()<deadline){
      try{
        const res=await port.fetch('http://container/health',{signal:AbortSignal.timeout(1000)});
        const value=await res.text();
        if(res.ok&&value===COMPUTE_PROTOCOL)return port;
      }catch{}
      await scheduler.wait(200);
    }
    throw Error('LOC Container not ready');
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    const health=path==='/health'&&request.method==='GET';
    if(!health&&(path!=='/compute'||request.method!=='POST'))return new Response(null,{status:404});
    this.starting??=this.ready().finally(()=>{this.starting=undefined;});
    try{
      const port=await this.starting;
      if(health)return new Response(COMPUTE_PROTOCOL);
      return await port.fetch('http://container/compute',{
        method:'POST',headers:{'content-type':'application/json'},body:request.body,
        signal:AbortSignal.timeout(40000)
      });
    }catch{return new Response(null,{status:503});}
  }
}
