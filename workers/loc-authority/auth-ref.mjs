// Optional horizontal Auth Ref. It never issues a LOC identity or Scope grant:
// it checks a provider's signed/online evidence and returns a bounded assertion.
const PROVIDERS=new Set(['github','oidc','entra','ldap','ad','clerk']);
const text=new TextEncoder();
function reject(message,status=403){
 throw Object.assign(new Error(message),{status});
}
function bytes(value){
 if(!/^[A-Za-z0-9_-]+$/.test(String(value||'')))reject('Malformed external JWT',401);
 const encoded=String(value).replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'='));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function read(value){
 try{return JSON.parse(new TextDecoder().decode(bytes(value)))}
 catch{reject('Malformed external JWT',401)}
}
function trustedUrl(value){
 let url;
 try{url=new URL(value)}catch{reject('Invalid Auth Ref endpoint',503)}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
  !url.hostname||url.hostname==='localhost'||url.hostname.endsWith('.local')||
  url.hostname.endsWith('.internal')||/^(127|10|192\.168)\./.test(url.hostname)||
  /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname))
  reject('Untrusted Auth Ref endpoint',503);
 return url;
}
async function jsonFetch(url,{fetchImpl=fetch,token}={}){
 const target=trustedUrl(url);
 const result=await fetchImpl(target.href,{
  headers:{accept:'application/json',...(token?{authorization:'Bearer '+token,
   'user-agent':'LOC-Authority'}:{})},
  redirect:'manual',signal:AbortSignal.timeout(7000)
 });
 if(!result.ok)reject('External Auth Ref rejected or unavailable',result.status===401?401:502);
 return result.json().catch(()=>reject('Invalid Auth Ref response',502));
}
function configuredIssuer(type,profile){
 if(type==='entra'){
  const tenant=String(profile.tenant_id||'');
  if(!/^[A-Za-z0-9-]{4,100}$/.test(tenant))reject('Invalid Entra tenant',503);
  return 'https://login.microsoftonline.com/'+tenant+'/v2.0';
 }
 const value=type==='ad'||type==='ldap'?profile.bridge_issuer_url:profile.issuer_url;
 if(!value)reject('Auth Ref issuer is not configured',503);
 const u=trustedUrl(value);
 return u.href.replace(/\/$/,'');
}
function subjectClaims(claims){
 const parts=[];
 for(const field of ['groups','roles','permissions','memberOf','scp','scope']){
  const raw=claims[field];
  if(Array.isArray(raw))parts.push(...raw);
  else if(typeof raw==='string'&&(field==='scp'||field==='scope'))
   parts.push(...raw.split(/\s+/));
  else if(typeof raw==='string')parts.push(raw);
 }
 return [...new Set(parts.filter(x=>typeof x==='string'&&x.length>0&&x.length<300))];
}
async function jwtReference(type,credential,profile,options){
 const parts=credential.split('.');
 if(parts.length!==3||parts.some(x=>x.length>8192))reject('Invalid Auth Ref JWT',401);
 const header=read(parts[0]),claims=read(parts[1]);
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=='RS256'||!header.kid||!claims.sub||
  !Number.isSafeInteger(claims.exp)||claims.exp<=now||
  !Number.isSafeInteger(claims.iat)||claims.iat>now+60||
  claims.exp-claims.iat>86400)
  reject('Expired or unsupported Auth Ref token',401);
 const issuer=configuredIssuer(type,profile);
 if(claims.iss!==issuer)reject('Auth Ref issuer mismatch',401);
 if(options.expectedNonce&&claims.nonce!==options.expectedNonce)
  reject('Auth Ref OIDC nonce mismatch',401);
 const audience=String(profile.client_id||'');
 const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!audience||!audiences.includes(audience)||
  (claims.azp&&claims.azp!==audience))
  reject('Auth Ref audience mismatch',401);
 const discovery=type==='clerk'?{issuer,jwks_uri:issuer+'/.well-known/jwks.json'}:
  await jsonFetch(issuer+'/.well-known/openid-configuration',options);
 if(discovery.issuer!==issuer)reject('Auth Ref discovery mismatch',401);
 const jwksUrl=trustedUrl(discovery.jwks_uri);
 // Treat the configured issuer as the trust root; never fetch an arbitrary
 // certificate URL supplied by a token or redirected metadata response.
 if(jwksUrl.hostname!==trustedUrl(issuer).hostname)
  reject('Auth Ref signing key host mismatch',401);
 const jwks=await jsonFetch(jwksUrl.href,options);
 const jwk=jwks?.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
  (!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
 if(!jwk)reject('Auth Ref signing key not found',401);
 let valid=false;
 try{
  const key=await crypto.subtle.importKey('jwk',jwk,
   {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
   bytes(parts[2]),text.encode(parts[0]+'.'+parts[1]));
 }catch{}
 if(!valid)reject('Auth Ref signature invalid',401);
 return {provider:type,externalSubject:String(claims.sub).slice(0,256),
  email:claims.email_verified===true?String(claims.email||'').toLowerCase():'',
  emailVerified:claims.email_verified===true,
  permissions:subjectClaims(claims),
  expires:Math.min(Date.now()+300000,claims.exp*1000)};
}
async function githubReference(credential,options){
 const identity=await jsonFetch('https://api.github.com/user',
  {...options,token:credential});
 if(!Number.isSafeInteger(identity.id)||identity.id<=0||
  !/^[A-Za-z0-9-]{1,39}$/.test(String(identity.login||'')))
  reject('GitHub Auth Ref identity invalid',401);
 const permissions=[];
 if(identity.login)permissions.push('login:'+identity.login);
 // A second GitHub API result can attest email ownership. Missing OAuth
 // email scope never becomes an unverified privileged email claim.
 let email='';
 try{
  const emails=await jsonFetch('https://api.github.com/user/emails',
   {...options,token:credential});
  const chosen=Array.isArray(emails)?
   emails.find(x=>x.verified===true&&x.primary===true)||
   emails.find(x=>x.verified===true):null;
  if(chosen&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(chosen.email||'')))
   email=String(chosen.email).toLowerCase();
 }catch{}
 return {provider:'github',externalSubject:String(identity.id),email,
  emailVerified:Boolean(email),permissions,expires:Date.now()+300000};
}
export async function verifyAuthReference(provider,credential,profile,options={}){
 if(!PROVIDERS.has(provider))reject('Unsupported Auth Ref',400);
 if(!profile||profile.type!==provider||typeof credential!=='string'||
  credential.length<10||credential.length>12288)
  reject('Auth Ref proof or configuration missing',400);
 return provider==='github'?githubReference(credential,options):
  jwtReference(provider,credential,profile,options);
}
export function assertReferencePermission(attestation,provider,permission,now=Date.now()){
 if(!attestation||attestation.provider!==provider||
  !Number.isFinite(attestation.expires)||attestation.expires<=now)
  reject('Required Auth Ref missing or expired',403);
 if(permission&&!(attestation.permissions||[]).includes(permission))
  reject('Required Auth Ref permission denied',403);
 return true;
}
