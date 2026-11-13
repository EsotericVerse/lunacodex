// Private, one-way Channel 1 receiver. No user OAuth, scopeid or public database access.
import {sql,Kysely,PostgresDialect} from "npm:kysely@0.29.8";
import pg from "npm:pg@8.23.1";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const LETTERS="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const flags={statics:false,culture:false,search:false,trace:false,list:false,
 keyword:false,extract:false,others:false};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
async function equalSecret(value:string,expected:string){
 if(!expected||expected.length<32||!value)return false;
 const a=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value)));
 const b=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(expected)));
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
function uid8(){
 let result="";
 while(result.length<8){
  const pool=crypto.getRandomValues(new Uint8Array(16));
  for(const b of pool){
   if(b<248)result+=LETTERS[b%62];
   if(result.length===8)break;
  }
 }
 return result;
}
function site(host:string){
 const s=String(host||"").toLowerCase();
 if(s.endsWith("chatgpt.com")||s==="chat.openai.com")return "chatgpt";
 if(s.endsWith("claude.ai"))return "claude";
 if(s.endsWith("threads.net"))return "threads";
 if(s.endsWith("instagram.com"))return "instagram";
 if(s.endsWith("facebook.com")||s==="fb.com")return "facebook";
 if(s.endsWith("github.com"))return "github";
 if(s.endsWith("suno.com"))return "suno";
 return s.slice(0,100);
}
function valid(r:any){
 return r&&typeof r==="object"&&UUID.test(r.id)&&typeof r.content==="string"&&
 r.content.length>0&&r.content.length<=140000&&
 typeof r.title==="string"&&typeof r.source==="string"&&
 typeof r.url==="string"&&r.url.length<=4096&&
 Number.isInteger(r.part_index)&&r.part_index>=0&&
 Number.isInteger(r.part_count)&&r.part_count>=1&&r.part_count<=10000&&
 r.part_index<r.part_count&&UUID.test(r.group_id);
}
// Standalone fixed-operation ingestion via Kysely / pg; no generic SQL transport.
let connection:any=null;
function database(){
 if(connection)return connection;
 // First-party Channel 1 service uses a server-only LOC connection profile.
 const alias=String(Deno.env.get("LOC_CHANNEL1_DB_ALIAS")||
   Deno.env.get("LOC_CONTROL_DB_ALIAS")||"").trim();
 if(!/^[a-z][a-z0-9_]{0,63}$/.test(alias))
  throw Error("Channel 1 SQL alias is not configured");
 let sources:any;
 try{sources=JSON.parse(Deno.env.get("LOC_DB_CONNECTIONS_JSON")||"{}");}
 catch{throw Error("Invalid LOC SQL connections configuration");}
 const profile=sources?.[alias];
 if(profile?.engine!=="postgres"||typeof profile.url!=="string"||!profile.url)
  throw Error("Channel 1 SQL alias must point to PostgreSQL"); 
 const url=profile.url;
 const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:7000,idleTimeoutMillis:15000});
 connection=new Kysely({dialect:new PostgresDialect({pool})});
 return connection;
}
Deno.serve(async(request)=>{
 if(request.method!=="POST")return response({error:"method not allowed"},405);
 const expected=Deno.env.get("LOC_CHANNEL1_GALAXY_SECRET")||"";
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!await equalSecret(token,expected))return response({error:"unauthorized"},401);
 const dest=Deno.env.get("LOC_CHANNEL1_GALAXY_DESTINATION")||"";
 if(!["lo3rwang","lrunes"].includes(dest))return response({error:"destination not configured"},503);
 if(Number(request.headers.get("content-length")||0)>750000)return response({error:"too large"},413);
 const raw=await request.text();
 if(encoder.encode(raw).byteLength>750000)return response({error:"too large"},413);
 let batch:any;
 try{batch=JSON.parse(raw);}catch{return response({error:"invalid JSON"},400);}
 if(!batch||!UUID.test(batch.id)||!Array.isArray(batch.records)||
 batch.records.length<1||batch.records.length>50||!batch.records.every(valid))
  return response({error:"invalid batch"},400);
 const rows=batch.records.map((r:any)=>{
  const segment=r.part_count>1?" ["+(r.part_index+1)+"/"+r.part_count+"]":"";
  return {uid:uid8(),site:site(r.source),site_id:"loc-channel1/"+r.group_id+"/"+r.part_index,
   title:(r.title||"網頁紀錄").slice(0,270)+segment,
   content:r.content,url:r.url,createtime:null,date:null,...flags};
 });
 try{
  const db=database();
  const table="silver."+dest+"_galaxy";
  await db.transaction().execute(async(trx)=>{
   await sql`select pg_advisory_xact_lock(17483, 1)`.execute(trx);
   const existing=await trx.selectFrom(table).select("site_id")
    .where("site_id","in",rows.map(r=>r.site_id)).execute();
   const seen=new Set(existing.map(r=>r.site_id));
   const missing=rows.filter(r=>!seen.has(r.site_id));
   if(missing.length)await trx.insertInto(table).values(missing).execute();
  });
  return response({accepted:true,id:batch.id,count:batch.records.length});
 }catch(error){
  console.error("[LOC Channel1 ingest]",error);
  return response({error:"database unavailable; batch not acknowledged"},503);
 }
});
