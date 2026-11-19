'use client';
import {createContext,useCallback,useContext,useEffect,useState} from 'react';
import {useAccount,readVerifiedManagementEntry} from '../auth/use-account';
import {useEditDock} from '../../modular/edit-dock';
import {FeaturePage} from '../../modular/ui';
import {editorSessionStatus,clearEditorSession,touchEditorSession} from '../auth/edit-session-ttl.mjs';
import {dbAuthEvents} from '../db/db-client.mjs';
import {verifyManagementEntry} from '../auth/management-entry-verification.mjs';
import {releaseTransientPageResources} from '../../../packages/zenstack/client-queries';

const granted=(grants,id,level)=>level==='global'
  ?Boolean(grants?.canLocAccessSync('global'))
  :level==='group'?Boolean(grants?.canLocAccessSync('group',id))
  :Boolean(grants?.canLocAccessSync('scope',id));
const pending=()=>({loading:true,user:null,authorizer:null,error:''});
const ManagementEntryContext=createContext(null);

// Visible template belongs to the page. This gate owns only the protected
// editor/data slot; no fixed CSS, NAV, Hero or section label depends on Auth.
export function ProtectedManagementSlot({children}){
  const entry=useContext(ManagementEntryContext);
  if(!entry)return null; // Fail closed outside the verified management route.
  const {ready,allowed,entered,locked,verification,retry}=entry;
  if(ready&&allowed&&entered&&!locked)return children;
  const denied=ready&&(!allowed||locked);
  return <section className="loc-card scope-feature-card" role={denied?'alert':'status'}>
    {denied?<><p>{verification.error||(locked
      ?'編輯 Session 已過期，請手動重新確認。'
      :verification.user
        ?'LOC 身分已驗證，但沒有此範圍的管理權限。'
        :'目前沒有有效的 LOC Session，編輯模式未啟用。')}</p>
      <button type="button" onClick={retry}>重新確認 Session</button>{' '}
      <a href="/local/settings/">前往設定頁</a></>
      :<p>正在確認管理操作權限…</p>}
  </section>;
}

// Each protected management entry verifies Scope permission before rendering
// editing controls. An OAuth session alone never grants LOC Scope access.
export default function ManagementAccess({scopeId,level='scope',featureId='manage',staticFrame=false,children}){
  const account=useAccount({enabled:false}),dock=useEditDock();
  const [verification,setVerification]=useState(pending);
  const [locked,setLocked]=useState(false);
  const [retryAttempt,setRetryAttempt]=useState(0);
  const check=useCallback(()=>editorSessionStatus(window.sessionStorage).expired
    ?account.refresh()
    :(readVerifiedManagementEntry()||account.refresh()),[account.refresh]);

  useEffect(()=>{
    // Entry barrier: before any managed editor data mounts, retire the old
    // page's pending query generation and everything except identity/grants.
    releaseTransientPageResources();
  },[scopeId,level,featureId]);

  useEffect(()=>{
    let active=true;
    // Only entry or an explicit retry verifies the editing Session.
    setVerification(pending());
    void verifyManagementEntry(retryAttempt>0?account.refresh:check).then(result=>{
      if(!active)return;
      if(retryAttempt>0&&result?.user&&granted(result.authorizer,scopeId,level)){
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
  },[check,account.refresh,scopeId,level,retryAttempt]);

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

  // Denied/expired editing stops here. Never redirect to sign-in.
  // Auth session state is checked only on editor entry or manual retry.
  useEffect(()=>{
    if(!ready||(allowed&&!locked))return;
    window.dispatchEvent(new CustomEvent('loc-management-entry-denied',{detail:{scopeId}}));
  },[ready,allowed,locked,scopeId]);

  useEffect(()=>{
    if(!allowed||entered)return;
    if(editorSessionStatus(window.sessionStorage).expired){setLocked(true);return;}
    setLocked(false);
    const started=dock?.begin(scopeId,{globalManage:Boolean(verification.authorizer?.canLocAccessSync('global'))});
    if(started!==true){
      // Do not leave the editor in an endless "opening" state if the route
      // Scope or browser Session cannot activate the existing Edit Dock.
      setVerification(previous=>({...previous,user:null,authorizer:null,
        error:'LOC 編輯 Session 無法啟用，請重新確認目前 Scope 與 Session。'}));
    }
  },[allowed,entered,scopeId,dock?.begin,verification.authorizer]);

  if(staticFrame)return <ManagementEntryContext.Provider value={{
    ready,allowed,entered,locked,verification,
    retry:()=>{setLocked(false);setRetryAttempt(value=>value+1);}
  }}>{children}</ManagementEntryContext.Provider>;

  if(ready&&(!allowed||locked))return <FeaturePage featureId={featureId}>
    <section className="loc-card scope-feature-card">
      <p role="alert">{verification.error||(locked
        ?'編輯 Session 已過期，請手動重新確認。'
        :verification.user
          ?'LOC 身分已驗證，但這個帳號沒有此範圍的管理權限。'
          :'目前沒有有效的 LOC Session，編輯模式未啟用。')}</p>
      <button type="button" onClick={()=>{
        setLocked(false);setRetryAttempt(value=>value+1);
      }}>重新確認 Session</button>{' '}
      <a href="/local/settings/">前往設定頁</a>
    </section>
  </FeaturePage>;
  if(!ready||!allowed||!entered)return <FeaturePage featureId={featureId}>
    <section className="loc-card scope-feature-card">
      <p role="status">正在開啟 LOC 身分驗證…</p>
    </section>
  </FeaturePage>;
  return children;
}
