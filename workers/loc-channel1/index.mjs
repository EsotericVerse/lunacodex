const enc=new TextEncoder();
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const decode=(s)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),x=>x.charCodeAt(0));
async function authorized(raw,secret){
 if(!raw||!secret)return false;
 try{
  const [a,b,c,...rest]=raw.split('.');if(!a||!b||!c||rest.length)return false;
  const header=JSON.parse(new TextDecoder().decode(decode(a)));
  const claims=JSON.parse(new TextDecoder().decode(decode(b)));
  if(header.alg!=='HS256'||header.typ!=='JWT'||claims.iss!=='loc-channel1'||claims.aud!=='loc-kv-inbox')return false;
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('HMAC',key,decode(c),enc.encode(a+'.'+b));
  const now=Math.floor(Date.now()/1000);
  return ok&&typeof claims.exp==='number'&&now<claims.exp&&typeof claims.nbf==='number'&&now>=claims.nbf&&Array.isArray(claims.scopes)&&claims.scopes.includes('record:create');
 }catch{return false;}
}
async function save(request,env){
 const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!(await authorized(token,env.LOC_CHANNEL1_SECRET)))return respond({error:'unauthorized'},401);
 const size=Number(request.headers.get('content-length')||0);
 if(size>800000)return respond({error:'too large'},413);
 let payload;
 try{payload=await request.json();}catch{return respond({error:'bad json'},400);}
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||!/^[0-9a-f-]{36}$/.test(payload.id||'')||typeof payload.content!=='string'||payload.content.length>600000||!payload.content||typeof payload.source!=='string')return respond({error:'invalid record'},400);
 const value=JSON.stringify({...payload,received_at:new Date().toISOString()});
 if(enc.encode(value).byteLength>800000)return respond({error:'too large'},413);
 const key='pending/'+payload.id;
 if(await env.LOC_KV.get(key)||await env.LOC_KV.get('archive/'+payload.id))return respond({accepted:true,id:payload.id,duplicate:true});
 await env.LOC_KV.put(key,value);return respond({accepted:true,id:payload.id});
}
async function sync(env){
 if(!env.LOC_GALAXY_SYNC_URL||!env.LOC_GALAXY_SYNC_SECRET){console.warn('LOC hourly sync is not configured');return;}
 const items=await env.LOC_KV.list({prefix:'pending/',limit:100});
 for(const item of items.keys){
  const raw=await env.LOC_KV.get(item.name);if(!raw)continue;
  const record=JSON.parse(raw);
  try{
   const result=await fetch(env.LOC_GALAXY_SYNC_URL,{method:'POST',headers:{authorization:'Bearer '+env.LOC_GALAXY_SYNC_SECRET,'content-type':'application/json'},body:JSON.stringify({record})});
   if(!result.ok)throw Error('Galaxy HTTP '+result.status);
   await env.LOC_KV.put('archive/'+record.id,raw);
   await env.LOC_KV.delete(item.name);
  }catch(error){console.error('LOC Galaxy sync failed',item.name,error);}
 }
}
export default {
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(request.method==='POST'&&path==='/v1/record')return save(request,env);
  if(request.method==='GET'&&path==='/health')return respond({status:'ready'});
  return respond({error:'not found'},404);
 },
 async scheduled(_event,env,ctx){ctx.waitUntil(sync(env));}
};
