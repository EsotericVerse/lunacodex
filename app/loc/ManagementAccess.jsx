'use client';
import {useCallback,useEffect,useState} from 'react';
import {useAccount,readVerifiedManagementEntry} from './use-account';
import {useEditDock} from '../modular/edit-dock';
import {FeaturePage} from '../modular/ui';
import {editorSessionStatus,clearEditorSession,touchEditorSession} from './edit-session-ttl.mjs';
import {dbAuthEvents} from './db-client.mjs';
import {verifyManagementEntry} from './auth/management-entry-verification.mjs';
import {releaseTransientPageResources} from '../../zenstack/client-queries';

const granted=(grants,id,level)=>level==='global'
  ?Boolean(grants?.canLocAccessSync('global'))
  :level==='group'?Boolean(grants?.canLocAccessSync('group',id))
  :Boolean(grants?.canLocAccessSync('scope',id));
const pending=()=>({loading:true,user:null,authorizer:null,error:''});

// Each protected management entry verifies Scope permission before rendering
// editing controls. An OAuth session alone never grants LOC Scope access.
export default function ManagementAccess({scopeId,level='scope',featureId='manage',children}){
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
    dock?.begin(scopeId,{globalManage:Boolean(verification.authorizer?.canLocAccessSync('global'))});
  },[allowed,entered,scopeId,dock?.begin,verification.authorizer]);

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
