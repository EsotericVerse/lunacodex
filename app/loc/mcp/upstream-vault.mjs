// Separate LOC MCP control-plane storage. No database schema changes.
// KV binding and encryption secret are mandatory; never fall back to memory.
const enc=new TextEncoder();
const dec=new TextDecoder();
function b64(bytes){
  let text='';for(const byte of bytes)text+=String.fromCharCode(byte);
  return btoa(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function unb64(value){
  const text=atob(String(value).replaceAll('-','+').replaceAll('_','/')+
    '='.repeat((4-String(value).length%4)%4));
  return Uint8Array.from(text,c=>c.charCodeAt(0));
}
export function randomValue(size=32){
  const bytes=new Uint8Array(size);
  crypto.getRandomValues(bytes);return b64(bytes);
}
export async function hashValue(value){
  const digest=await crypto.subtle.digest('SHA-256',enc.encode(String(value)));
  return b64(new Uint8Array(digest));
}
async function encryptionKey(env){
  const secret=String(env.LOC_MCP_PROVIDER_ENCRYPTION_KEY||'');
  if(secret.length<32)throw new Error('LOC MCP provider encryption secret unavailable');
  const digest=await crypto.subtle.digest('SHA-256',enc.encode(secret));
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export function providerStoreReady(env={}){
  return Boolean(env.LOC_MCP_PROVIDER_STORE&&
    typeof env.LOC_MCP_PROVIDER_STORE.get==='function'&&
    typeof env.LOC_MCP_PROVIDER_STORE.put==='function'&&
    String(env.LOC_MCP_PROVIDER_ENCRYPTION_KEY||'').length>=32);
}
function binding(env){
  if(!providerStoreReady(env))throw new Error('LOC MCP provider vault is not configured');
  return env.LOC_MCP_PROVIDER_STORE;
}
export async function providerKey(subject,provider){
  if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject)))throw new Error('Invalid LOC identity');
  return 'link:'+await hashValue(subject)+':'+provider;
}
export async function pendingPrefix(subject){
  if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject)))throw new Error('Invalid LOC identity');
  return 'approval:'+await hashValue(subject)+':';
}
export async function vaultPut(env,key,record,ttl){
  const nonce=new Uint8Array(12);crypto.getRandomValues(nonce);
  const data=enc.encode(JSON.stringify(record));
  if(data.byteLength>64000)throw new Error('LOC MCP record too large');
  const encrypted=await crypto.subtle.encrypt(
    {name:'AES-GCM',iv:nonce,additionalData:enc.encode(key)},
    await encryptionKey(env),data);
  await binding(env).put(key,JSON.stringify({v:1,nonce:b64(nonce),value:b64(new Uint8Array(encrypted))}),
    ttl?{expirationTtl:ttl}:undefined);
}
export async function vaultGet(env,key){
  const item=await binding(env).get(key);
  if(!item)return null;
  const input=JSON.parse(item);
  if(input?.v!==1)throw new Error('Unsupported provider vault record');
  const decrypted=await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:unb64(input.nonce),additionalData:enc.encode(key)},
    await encryptionKey(env),unb64(input.value));
  return JSON.parse(dec.decode(decrypted));
}
export async function vaultDelete(env,key){await binding(env).delete(key);}
export async function vaultList(env,prefix,limit=50){
  const result=await binding(env).list({prefix,limit});
  return result.keys.map(x=>x.name);
}
