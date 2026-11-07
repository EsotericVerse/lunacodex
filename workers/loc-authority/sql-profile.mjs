// Trusted server-to-server profile access for independent LOC SQL Gateways.
// Browser OAuth tokens, unsigned DB names and caller-provided URLs never grant
// access to decrypted database credentials. One long-lived service secret is
// configured once; switching per-user targets only updates Authority DO state.
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const LOC=/^loc_[A-Za-z0-9_-]{32,80}$/;
const ENGINES=new Set(['postgres','mysql','mssql']);
const encoder=new TextEncoder();
function denied(reason,status=403){throw Object.assign(new Error(reason),{status});}
function decode(value){
 if(!/^[A-Za-z0-9_-]+$/.test(String(value||'')))denied('Invalid LOC token',401);
 const base=String(value).replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(base.padEnd(Math.ceil(base.length/4)*4,'='));
 return Uint8Array.from(raw,unit=>unit.charCodeAt(0));
}
async function equalSecret(received,configured){
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(String(configured||'')))
  denied('Gateway service authentication is not provisioned',503);
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(String(received||'')))return false;
 const hashes=await Promise.all([received,configured].map(x=>
  crypto.subtle.digest('SHA-256',encoder.encode(x))));
 const a=new Uint8Array(hashes[0]),b=new Uint8Array(hashes[1]);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
async function verifiedDelegation(request,stub){
 const bearer=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
 if(!bearer||bearer[1].length>8192)denied('Signed LOC delegation required',401);
 const pieces=bearer[1].split('.');
 if(pieces.length!==3)denied('Invalid LOC delegation',401);
 let header,payload;
 try{header=JSON.parse(new TextDecoder().decode(decode(pieces[0])));
  payload=JSON.parse(new TextDecoder().decode(decode(pieces[1])));}catch{
  denied('Invalid LOC delegation',401);
 }
 const now=Math.floor(Date.now()/1000);
 if(header?.alg!=='RS256'||typeof header.kid!=='string'||
   payload?.iss!=='loc'||!['loc-delegation','loc-mcp'].includes(payload.aud)||
   payload?.me!==true||!LOC.test(String(payload.sub||''))||
   !ID.test(String(payload.db_target||''))||
   !Number.isSafeInteger(payload.iat)||payload.iat>now+30||
   !Number.isSafeInteger(payload.nbf)||payload.nbf>now+30||
   !Number.isSafeInteger(payload.exp)||payload.exp<=now||
   payload.exp-payload.iat>600)
  denied('Invalid delegated database selection',401);
 const jwks=await stub.delegationJwks();
 const key=jwks.keys.find(x=>x.kid===header.kid&&x.kty==='RSA'&&x.alg==='RS256');
 if(!key)denied('LOC delegation signing key unavailable',401);
 let valid=false;
 try{
  const publicKey=await crypto.subtle.importKey('jwk',key,
   {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,
   decode(pieces[2]),encoder.encode(pieces[0]+'.'+pieces[1]));
 }catch{}
 if(!valid)denied('LOC delegation signature invalid',401);
 return payload;
}
export async function trustedSqlProfile(request,env,stub){
 if(request.method!=='POST'||request.headers.has('origin'))denied('Server-only SQL profile endpoint',403);
 if(!await equalSecret(request.headers.get('x-loc-sql-service-key'),
  env.LOC_SQL_GATEWAY_SERVICE_KEY))denied('SQL Gateway service authentication failed',403);
 const raw=await request.text();
 if(raw.length>500)denied('Invalid SQL profile request',413);
 let input;try{input=JSON.parse(raw)}catch{denied('Invalid SQL profile request',400)}
 if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).some(x=>x!=='id')||!ID.test(String(input.id||'')))
  denied('Invalid SQL profile identifier',400);
 const claims=await verifiedDelegation(request,stub);
 if(claims.db_target!==input.id)denied('LOC database selection does not match delegation',403);
 const roots=String(env.LOC_RECOVERY_ROOT_LOC_SUBJECTS||'').split(/[\s,;]+/).filter(Boolean);
 if(!await stub.verifyLiveDatabaseSelection(claims.sub,input.id,roots.includes(claims.sub)))
  denied('LOC account database selection is no longer authorized',403);
 const profile=await stub.getProfileForGateway(input.id);
 if(!profile||!ENGINES.has(profile.engine))denied('LOC database connection missing',404);
 return new Response(JSON.stringify({id:input.id,profile}),{
  status:200,headers:{'content-type':'application/json; charset=utf-8',
   'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
