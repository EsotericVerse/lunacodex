'use client';
import {useCallback,useEffect,useState} from 'react';
import {useAccount,readVerifiedManagementEntry} from './use-account';
import {useEditDock} from '../modular/edit-dock';
import {FeaturePage} from '../modular/ui';
import {editorSessionStatus,clearEditorSession,touchEditorSession} from './edit-session-ttl.mjs';
import {dbAuthEvents} from './db-client.mjs';
import {verifyManagementEntry} from './auth/management-entry-verification.mjs';

const granted=(grants,id,level)=>level==='global'
  ?Boolean(grants?.canManageGlobalSync())
  :level==='group'?Boolean(grants?.canManageGroupSync(id))
  :Boolean(grants?.canManageScopeSync(id));
const pending=()=>({loading:true,user:null,authorizer:null,error:''});

// The first management entry verifies Clerk and Scope together. Subsequent
// transitions within the same document reuse that identity's verified grant.
// Server RLS still validates writes; expired editor sessions reverify.
export default function ManagementAccess({scopeId,level='scope',featureId='manage',children}){
  const account=useAccount({enabled:false}),dock=useEditDock();
  const [verification,setVerification]=useState(pending);
  const [retry,setRetry]=useState(0);
  const [locked,setLocked]=useState(false);
  const [renewing,setRenewing]=useState(false);
  const [error,setError]=useState('');
  // One role fetch per verified identity. Explicit expired-session renewal
  // always performs a fresh network verification.
  const check=useCallback(()=>editorSessionStatus(window.sessionStorage).expired
    ?account.refresh()
    :(readVerifiedManagementEntry()||account.refresh()),[account.refresh]);

  useEffect(()=>{
    let active=true;
    setVerification(pending());
    void verifyManagementEntry(check).then(result=>{
      if(!active)return;
      setVerification({loading:false,user:result?.user||null,
        authorizer:result?.authorizer||null,error:''});
    }).catch(cause=>{
      if(!active)return;
      setVerification({loading:false,user:null,authorizer:null,
        error:String(cause?.message||cause||'管理權限查詢失敗')});
    });
    return ()=>{active=false;};
  },[check,scopeId,level,retry]);

  // An actual sign-out/account change must revoke this independently-held
  // UI grant; a first empty Clerk hydration event is not a real sign-out.
  useEffect(()=>{
    if(!verification.user)return undefined;
    let active=true;
    const currentId=String(verification.user.id);
    const observer=dbAuthEvents.onAuthStateChange((event,session)=>{
      if(!active)return;
      const otherId=String(session?.user?.id||'');
      if(event==='SIGNED_OUT'||(otherId&&otherId!==currentId)){
        setVerification({loading:false,user:null,authorizer:null,
          error:'Clerk 登入身分已變更，管理權限已解除。'});
        dock?.end();
      }
    });
    return ()=>{active=false;observer.data.subscription.unsubscribe();};
  },[verification.user?.id,dock?.end]);

  const ready=!verification.loading;
  const allowed=Boolean(ready&&verification.user&&
    granted(verification.authorizer,scopeId,level));
  const entered=Boolean(dock?.active&&dock.scopeId===scopeId);
  useEffect(()=>{
    if(!allowed||entered)return;
    if(editorSessionStatus(window.sessionStorage).expired){setLocked(true);return;}
    setLocked(false);
    dock?.begin(scopeId);
  },[allowed,entered,scopeId,dock?.begin]);

  async function renew(){
    if(renewing||!allowed||entered||!locked)return;
    setRenewing(true);setError('');
    try{
      // Exactly the same live authorization path as initial edit entry.
      // Do not re-implement Clerk/permission checks or consult a TTL cache.
      const verified=await verifyManagementEntry(check);
      if(!verified?.user||String(verified.user.id)!==String(verification.user.id)||
        String(verified.user.email||'').toLowerCase()!==
          String(verification.user.email||'').toLowerCase())
        throw Error('登入身分已變更，請重新驗證管理權限。');
      if(!granted(verified.authorizer,scopeId,level))
        throw Error('重新驗證後，沒有此管理範圍的權限。');
      setVerification({loading:false,user:verified.user,
        authorizer:verified.authorizer,error:''});
      clearEditorSession(window.sessionStorage);
      if(!touchEditorSession(window.sessionStorage))throw Error('無法重建編輯 Session。');
      setLocked(false);
      dock?.begin(scopeId);
    }catch(cause){setError(String(cause?.message||cause));}
    finally{setRenewing(false);}
  }
  if(!ready||!verification.user||!allowed||!entered)return <FeaturePage featureId={featureId}>
    <section className="loc-card scope-feature-card">
      {!ready?<p role="status">正在確認管理權限…</p>
        :verification.error?<p role="alert">管理權限核驗失敗，暫時無法編輯。</p>
        :!verification.user?<p>請先使用 Clerk 登入才能進入管理。</p>
        :!allowed?<p role="alert">沒有此 {level==='group'?'Scope Group':level==='global'?'系統':'Scope'} 的管理權限。</p>
        :locked?<><p role="status">編輯 Session 已鎖定，請重新驗證後進入管理。</p>
          <button className="loc-button" type="button" disabled={renewing} onClick={renew}>
            {renewing?'正在重新驗證…':'重新驗證並進入管理'}
          </button></>:<p role="status">正在啟用管理介面…</p>}
      {verification.error?<p className="scope-status scope-error" role="alert">{verification.error}</p>:null}
      {ready&&!allowed?<button className="loc-button" type="button"
        onClick={()=>{setError('');setRetry(value=>value+1);}}>重新確認管理權限</button>:null}
      {error?<p className="scope-status scope-error" role="alert">{error}</p>:null}
    </section>
  </FeaturePage>;
  return children;
}
