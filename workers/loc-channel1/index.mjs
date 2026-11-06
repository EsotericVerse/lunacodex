const encoder=new TextEncoder();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function bytes(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));}
async function authorized(value,secret){
 if(!value||!secret)return false;
 try{
  const [a,b,c,...extra]=value.split('.');
  if(!a||!b||!c||extra.length)return false;
  const h=JSON.parse(new TextDecoder().decode(bytes(a)));
  const p=JSON.parse(new TextDecoder().decode(bytes(b)));
  if(h.alg!=='HS256'||h.typ!=='JWT'||p.iss!=='loc-channel1'||p.aud!=='loc-kv-inbox')return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',key,bytes(c),encoder.encode(a+'.'+b)))return false;
  const now=Math.floor(Date.now()/1000);
  return Number.isFinite(p.exp)&&p.exp>now&&Number.isFinite(p.nbf)&&p.nbf<=now&&
   Array.isArray(p.scopes)&&p.scopes.includes('record:create');
 }catch{return false;}
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkedRecord(r){
 return r&&typeof r==='object'&&!Array.isArray(r)&&UUID.test(r.id)&&
 typeof r.content==='string'&&r.content.length>0&&r.content.length<=140000&&
 typeof r.source==='string'&&r.source.length>0&&r.source.length<=250&&
 typeof r.title==='string'&&r.title.length<=350&&
 typeof r.url==='string'&&r.url.length<=4096&&typeof r.captured_at==='string'&&
 UUID.test(r.group_id)&&Number.isInteger(r.part_count)&&r.part_count>=1&&
 r.part_count<=10000&&Number.isInteger(r.part_index)&&
 r.part_index>=0&&r.part_index<r.part_count;
}
async function accept(request,env){
 const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!await authorized(token,env.LOC_CHANNEL1_SECRET))return json({error:'unauthorized'},401);
 if(Number(request.headers.get('content-length')||0)>750000)return json({error:'batch too large'},413);
 const raw=await request.text();
 if(encoder.encode(raw).length>750000)return json({error:'batch too large'},413);
 let input;try{input=JSON.parse(raw);}catch{return json({error:'invalid json'},400);}
 if(!input||!UUID.test(input.id)||!Array.isArray(input.records)||
 input.records.length<1||input.records.length>50||!input.records.every(checkedRecord))
  return json({error:'invalid batch'},400);
 const key='pending/'+input.id;
 if(await env.LOC_KV.get(key)||await env.LOC_KV.get('archive/'+input.id))
  return json({accepted:true,id:input.id,duplicate:true});
 await env.LOC_KV.put(key,JSON.stringify({id:input.id,records:input.records,received_at:new Date().toISOString()}));
 return json({accepted:true,id:input.id});
}
async function sync(env){
 // Must not contact Galaxy when KV is empty.
 const page=await env.LOC_KV.list({prefix:'pending/',limit:100});
 if(!page.keys.length)return;
 if(!env.LOC_GALAXY_SYNC_URL||!env.LOC_GALAXY_SYNC_SECRET){
  console.error('LOC Galaxy receiver is not configured; preserving KV pending records');
  return;
 }
 for(const item of page.keys){
  const raw=await env.LOC_KV.get(item.name);
  if(!raw)continue;
  const batch=JSON.parse(raw);
  try{
   const response=await fetch(env.LOC_GALAXY_SYNC_URL,{
    method:'POST',headers:{authorization:'Bearer '+env.LOC_GALAXY_SYNC_SECRET,
     'content-type':'application/json'},
    body:JSON.stringify(batch),redirect:'error',signal:AbortSignal.timeout(20000)
   });
   if(!response.ok)throw Error('Galaxy HTTP '+response.status);
   const result=await response.json();
   if(result.accepted!==true||result.id!==batch.id||result.count!==batch.records.length)
    throw Error('Galaxy did not acknowledge complete batch');
   await env.LOC_KV.put('archive/'+batch.id,raw);
   await env.LOC_KV.delete(item.name);
  }catch(error){console.error('LOC pending batch retained:',item.name,String(error));}
 }
}
export default {
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(request.method==='POST'&&path==='/v1/batch')return accept(request,env);
  if(request.method==='GET'&&path==='/health')return json({ready:true});
  return json({error:'not found'},404);
 },
 async scheduled(_event,env,ctx){ctx.waitUntil(sync(env));}
};
