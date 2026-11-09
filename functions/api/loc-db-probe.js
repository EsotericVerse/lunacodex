// TEMPORARY connection status probe. No DB reads or writes; never returns
// credentials, SQL text, profiles, subjects, tokens or database names.
export async function onRequestGet({env}){
  const result={};const secret=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
  if(secret.length<32)return Response.json({profile_status:'token_unavailable'},
    {headers:{'cache-control':'no-store'}});
  for(const alias of ['loc_main','loc-main']){
    try{
      const res=await fetch('https://auth.lo3rwang.cc/v1/internal/database/'+alias,{
        method:'GET',headers:{'x-loc-service-token':secret,accept:'application/json'},
        cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7000)
      });
      // Do not consume a successful response: its body contains DB credentials.
      result[alias]=res.status;
    }catch(e){
      result[alias]={name:String(e?.name||'Error').slice(0,40),message:String(e?.message||'').replaceAll(secret,'[redacted]').slice(0,180),cause:String(e?.cause?.message||'').replaceAll(secret,'[redacted]').slice(0,180)};
    }
  }
  try{
    const test=await fetch('https://www.cloudflare.com/cdn-cgi/trace',{
      method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)
    });
    result.public_egress=test.status;
  }catch(e){result.public_egress={name:String(e?.name||'Error').slice(0,40),
    message:String(e?.message||'').slice(0,180)};}
  return Response.json({profile_status:result},
    {headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
