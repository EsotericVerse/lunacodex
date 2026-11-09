// One-time, scoped OAuth permission consent. The current LOC Authority
// Durable Object stores approval records; no SQL/Auth schema is introduced.
export const DATA_CONTRACT_VERSION='loc-oauth-data-contract-v1';
const LIMIT=64;
const ENC=new TextEncoder();
const labels=Object.freeze({
 'profile':'讀取已驗證的 LOC 身分識別',
 'email':'讀取已驗證的電子郵件',
 'offline_access':'在授權有效期間內更新登入憑證',
 'loc:import':'在 api.manage 許可的範圍內提出匯入寫入要求',
 'loc:manage':'提出 LOC 管理及資料寫入要求（實際操作仍須 api.manage 核准）'
});
function escapeHtml(v){
 return String(v||'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 })[c]);
}
function normalizeScopes(value){
 if(!Array.isArray(value)||value.length>LIMIT||
  value.some(x=>typeof x!=='string'||!Object.hasOwn(labels,x)))
  throw new Error('Invalid OAuth consent scopes');
 return [...new Set(value)].sort();
}
export async function consentKey(subject,clientId,resource){
 const bytes=ENC.encode(JSON.stringify([subject,clientId,resource]));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return 'native-consent-approval:'+Array.from(new Uint8Array(digest),
  b=>b.toString(16).padStart(2,'0')).join('');
}
export async function approvedConsent(stub,subject,clientId,resource,scope){
 const saved=await stub.nativeGet(await consentKey(subject,clientId,resource));
 const scopes=normalizeScopes(String(scope||'').split(' ').filter(Boolean));
 return Boolean(saved&&saved.version===DATA_CONTRACT_VERSION&&
  saved.subject===subject&&saved.clientId===clientId&&saved.resource===resource&&
  Array.isArray(saved.scopes)&&scopes.every(x=>saved.scopes.includes(x)));
}
export async function recordConsent(stub,subject,clientId,resource,scope){
 const key=await consentKey(subject,clientId,resource);
 const saved=await stub.nativeGet(key);
 const previous=saved?.version===DATA_CONTRACT_VERSION&&
  saved?.subject===subject&&saved?.clientId===clientId&&saved?.resource===resource&&
  Array.isArray(saved?.scopes)?saved.scopes:[];
 const scopes=normalizeScopes([...previous,...String(scope||'').split(' ').filter(Boolean)]);
 await stub.nativePut(key,{version:DATA_CONTRACT_VERSION,subject,clientId,resource,
  scopes,acceptedAt:new Date().toISOString()});
 return true;
}
export async function revokeConsent(stub,subject,clientId,resource){
 await stub.nativeTake(await consentKey(subject,clientId,resource));
 return true;
}
export function consentPage({nonce,clientName,scope,resource,identity}){
 const permissions=normalizeScopes(String(scope||'').split(' ').filter(Boolean));
 const items=permissions.map(x=>'<li>'+escapeHtml(labels[x])+'</li>').join('');
 return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="same-origin">'+
  '<title>LOC Auth · 展開資料合約</title><style>'+
  'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d111c;color:#f4f5fa;font:16px/1.7 system-ui,sans-serif}'+
  'main{box-sizing:border-box;width:min(92vw,670px);padding:clamp(22px,6vw,48px);border:1px solid #5b6480;border-radius:20px;background:#1b2233}'+
  'h1{font-size:clamp(24px,4vw,34px);line-height:1.2;margin:8px 0 22px}h2{font-size:18px}'+
  '.muted{color:#c0cad9}.contract{border:1px solid #687591;border-radius:12px;padding:18px;margin:18px 0}'+
  'button{padding:13px 20px;border-radius:10px;border:1px solid #b8c5df;font:inherit;cursor:pointer}'+
  'button[name=decision][value=approve]{background:#dce7ff;color:#101b30;font-weight:700}'+
  'button[name=decision][value=deny]{background:transparent;color:#f4f5fa}'+
  '.actions{display:flex;gap:12px;flex-wrap:wrap}li{margin:6px 0}small{color:#c0cad9}'+
  '</style></head><body><main><p class="muted">LOC AUTH · SINGLE SIGN-ON</p>'+
  '<h1>展開資料合約</h1><p>應用程式 <strong>'+escapeHtml(clientName)+
  '</strong> 要求以你的 LOC 身分取得下列授權。</p>'+
  '<p class="muted">登入身分：'+escapeHtml(identity)+'</p>'+
  '<section class="contract" aria-label="資料存取授權內容"><h2>本次授權範圍</h2><ul>'+items+'</ul>'+
  '<p>資源：<code>'+escapeHtml(resource)+'</code></p>'+
  '<p>登入身分與資料庫寫入權限分離。這項同意不直接賦予資料庫管理權限；寫入仍須經 LOC 依 api.manage 判定。</p>'+
  '<p>同一應用、資源與授權範圍在此版本合約下可沿用此次同意；若增加範圍或合約版本更新，將重新詢問。</p>'+
  '<small>合約版本：'+DATA_CONTRACT_VERSION+'</small></section>'+
  '<form method="POST" action="/oauth/consent"><input type="hidden" name="nonce" value="'+
  escapeHtml(nonce)+'"><div class="actions">'+
  '<button type="submit" name="decision" value="approve">我已閱讀並同意授權</button>'+
  '<button type="submit" name="decision" value="deny">不同意，返回應用程式</button>'+
  '</div></form></main></body></html>';
}
