'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAccount,readVerifiedManagementEntry} from './use-account';
import {useEditDock} from '../modular/edit-dock';
import {FeaturePage} from '../modular/ui';
import {editorSessionStatus,clearEditorSession,touchEditorSession} from './edit-session-ttl.mjs';
import {dbAuthEvents} from './db-client.mjs';
import {verifyManagementEntry} from './auth/management-entry-verification.mjs';

const LOGIN_RETURN_KEY='loc-management-login-return-v1';
const granted=(grants,id,level)=>level==='global'
  ?Boolean(grants?.canManageGlobalSync())
  :level==='group'?Boolean(grants?.canManageGroupSync(id))
  :Boolean(grants?.canManageScopeSync(id));
const pending=()=>({loading:true,user:null,authorizer:null,error:''});

// Each protected management entry verifies Scope permission before rendering
// editing controls. A Clerk sign-in alone never grants management access.
export default function ManagementAccess({scopeId,level='scope',featureId='manage',children}){
  const account=useAccount({enabled:false}),dock=useEditDock();
  const [verification,setVerification]=useState(pending);
  const [locked,setLocked]=useState(false);
  // Set once we arrive from the login page; a second denial must show its
  // reason instead of bouncing back to /login forever.
  const cameFromLogin=useRef(false);
  const check=useCallback(()=>editorSessionStatus(window.sessionStorage).expired
    ?account.refresh()
    :(readVerifiedManagementEntry()||account.refresh()),[account.refresh]);

  useEffect(()=>{
    let active=true;
    const path=window.location.pathname+window.location.search+window.location.hash;
    // This is only a UX return marker. The Scope permission must still be
    // verified live; it never acts as an authorization credential.
    const fromLogin=window.sessionStorage.getItem(LOGIN_RETURN_KEY)===path;
    if(fromLogin){cameFromLogin.current=true;window.sessionStorage.removeItem(LOGIN_RETURN_KEY);}
    setVerification(pending());
    void verifyManagementEntry(fromLogin?account.refresh:check).then(result=>{
      if(!active)return;
      if(fromLogin&&result?.user&&granted(result.authorizer,scopeId,level)){
        clearEditorSession(window.sessionStorage);
        if(!touchEditorSession(window.sessionStorage))
          throw Error('無法重新啟用編輯 Session');
      }
      setVerification({loading:false,user:result?.user||null,
        authorizer:result?.authorizer||null,error:''});
    }).catch(cause=>{
      if(!active)return;
      setVerification({loading:false,user:null,authorizer:null,
        error:String(cause?.message||cause||'管理權限查詢失敗')});
    });
    return ()=>{active=false;};
  },[check,account.refresh,scopeId,level]);

  // A verified account change revokes editing; an initial empty SDK event
  // is not an actual sign-out.
  useEffect(()=>{
    if(!verification.user)return undefined;
    let active=true;
    const currentId=String(verification.user.id);
    const observer=dbAuthEvents.onAuthStateChange((event,session)=>{
      if(!active)return;
      const otherId=String(session?.user?.id||'');
      if(event==='SIGNED_OUT'||(otherId&&otherId!==currentId)){
        setVerification({loading:false,user:null,authorizer:null,error:'身分已變更'});
        dock?.end();
      }
    });
    return ()=>{active=false;observer.data.subscription.unsubscribe();};
  },[verification.user?.id,dock?.end]);

  const ready=!verification.loading;
  const allowed=Boolean(ready&&verification.user&&
    granted(verification.authorizer,scopeId,level));
  const entered=Boolean(dock?.active&&dock.scopeId===scopeId);

  // Access failure or expired edit session returns to the full-screen Clerk
  // gateway; never expose a stale/denied editor or show an expiry text panel.
  useEffect(()=>{
    if(!ready||allowed&&!locked||cameFromLogin.current)return;
    window.dispatchEvent(new CustomEvent('loc-management-entry-denied',{detail:{scopeId}}));
    const target=window.location.pathname+window.location.search+window.location.hash;
    window.location.replace('/login/index.html?return_to='+encodeURIComponent(target));
  },[ready,allowed,locked,scopeId]);

  useEffect(()=>{
    if(!allowed||entered)return;
    if(editorSessionStatus(window.sessionStorage).expired){setLocked(true);return;}
    setLocked(false);
    dock?.begin(scopeId,{globalManage:Boolean(verification.authorizer?.canManageGlobalSync())});
  },[allowed,entered,scopeId,dock?.begin,verification.authorizer]);

  if(ready&&(!allowed||locked)&&cameFromLogin.current)return <FeaturePage featureId={featureId}>
    <section className="loc-card scope-feature-card">
      <p role="alert">{verification.error||(verification.user
        ?'LOC 身分已驗證，但這個帳號沒有此範圍的管理權限。'
        :'登入完成，但讀不到 LOC 身分（Session）。')}</p>
      <button type="button" onClick={()=>window.location.reload()}>重新驗證</button>{' '}
      <button type="button" onClick={()=>window.location.replace('/login/index.html?return_to='+
        encodeURIComponent(window.location.pathname+window.location.search+window.location.hash))}>
        回登入頁</button>
    </section>
  </FeaturePage>;
  if(!ready||!allowed||!entered)return <FeaturePage featureId={featureId}>
    <section className="loc-card scope-feature-card">
      <p role="status">正在開啟 LOC 身分驗證…</p>
    </section>
  </FeaturePage>;
  return children;
}
