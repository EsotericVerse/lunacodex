// Backend-only fixed Supabase API read probe. The opaque sb_secret API key
// must NEVER reach a browser, a Kysely profile, or the public response.
const ORIGIN=/^[a-z0-9-]+\.supabase\.co$/;
export async function checkSupabaseSecretLocAuth(env={},{
 fetchImpl=globalThis.fetch
}={}){
 const secret=String(env.LOC_SUPABASE_SECRET_KEY||'');
 if(!secret)return {ok:false,source:'supabase-rest',code:'SECRET_NOT_CONFIGURED'};
 let origin;
 try{
  origin=new URL(String(env.LOC_SUPABASE_AUTH_ORIGIN||''));
  if(origin.protocol!=='https:'||!ORIGIN.test(origin.hostname)||
     origin.username||origin.password||origin.port||origin.pathname!=='/'||
     origin.search||origin.hash)throw Error('Invalid origin');
 }catch{
  return {ok:false,source:'supabase-rest',code:'ORIGIN_INVALID'};
 }
 const uri=new URL('/rest/v1/loc_auth',origin);
 uri.searchParams.set('select','uid,email,scopeid,role');
 uri.searchParams.set('uid','eq.001');
 uri.searchParams.set('limit','1');
 let response;
 try{
  // Modern sb_secret API keys authenticate via apikey, not as JWT bearer
  // tokens. A legacy service_role JWT also works with its bearer header.
  response=await fetchImpl(uri.href,{
   method:'GET',headers:{
    apikey:secret,
    ...(!secret.startsWith('sb_secret_')&&secret.split('.').length===3
      ?{Authorization:'Bearer '+secret}:{}),
    'Accept-Profile':'silver',Accept:'application/json'
   },
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8500)
  });
 }catch{
  return {ok:false,source:'supabase-rest',code:'FETCH_FAILED'};
 }
 if(!response.ok){
  const obj=await response.json().catch(()=>null);
  const code=String(obj?.code||'');
  return{ok:false,source:'supabase-rest',status:response.status,
   code:/^[A-Za-z0-9_]{2,32}$/.test(code)?code:'API_HTTP_'+response.status};
 }
 const rows=await response.json().catch(()=>null);
 if(!Array.isArray(rows))return{ok:false,source:'supabase-rest',
   status:response.status,code:'INVALID_DATA'};
 const r=rows[0]||{};
 const matches={
  uidMatched:r.uid==='001',
  emailMatched:r.email==='sopa2306@gmail.com',
  scopeMatched:r.scopeid==='lo3rwang',
  roleMatched:r.role==='admin'
 };
 const ok=rows.length===1&&Object.values(matches).every(Boolean);
 return{ok,source:'supabase-rest',status:response.status,
  rowMatched:rows.length===1,...matches,...(!ok?{code:'ROW_MISMATCH'}:{})};
}
