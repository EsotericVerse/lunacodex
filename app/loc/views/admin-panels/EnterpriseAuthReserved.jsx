'use client';
import {useEffect,useState} from 'react';

// LOC Auth is an independent Better Auth issuer. Its provider configuration
// belongs to the Better Auth deployment, not to a handmade website registry.
// This Admin view is informational; it never stores OAuth secrets or roles.
const AUTH='https://auth.lo3rwang.cc';
export default function EnterpriseAuthReserved(){
  const [metadata,setMetadata]=useState(null);
  const [status,setStatus]=useState('正在確認 LOC Auth OIDC 公開資訊…');
  useEffect(()=>{
    let active=true;
    fetch(AUTH+'/.well-known/openid-configuration',{
      method:'GET',credentials:'omit',cache:'no-store',
      signal:AbortSignal.timeout(8000)
    }).then(async response=>{
      if(!response.ok)throw Error('OIDC metadata unavailable');
      return response.json();
    }).then(info=>{
      if(!active)return;
      setMetadata(info);
      setStatus('LOC Auth 已公布 OIDC Discovery。');
    }).catch(()=>{
      if(active)setStatus('LOC Auth 目前無法取得 OIDC Discovery；網站資料讀取不受影響。');
    });
    return()=>{active=false};
  },[]);
  return <section className="loc-card admin-workspace" aria-labelledby="admin-auth-heading">
    <h2 id="admin-auth-heading">LOC Auth</h2>
    <p className="scope-status">
      LOC Auth 由 Better Auth 原生模組提供 Cloudflare SSO、OIDC、
      JWT 與 JWKS。資料庫使用 PostgreSQL；網站公開資料與編輯權限由 LOC 自己管理。
    </p>
    <p className="scope-status" role="status">{status}</p>
    {metadata?<dl>
      <dt>Issuer</dt><dd>{String(metadata.issuer||'')}</dd>
      <dt>Authorization</dt><dd>{String(metadata.authorization_endpoint||'')}</dd>
      <dt>JWKS</dt><dd>{String(metadata.jwks_uri||'')}</dd>
    </dl>:null}
    <p className="scope-status">認證金鑰與身分提供者設定由 Better Auth 服務部署環境管理，
      此頁不提供自製 Auth 設定、密碼、角色或憑證編輯物件。</p>
  </section>;
}
