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
      result[alias]=e?.name==='TimeoutError'?'timeout':'network_failure';
    }
  }
  return Response.json({profile_status:result},
    {headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
