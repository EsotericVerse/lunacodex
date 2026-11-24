'use client';

import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {Capacitor} from '@capacitor/core';
import {dbAuthEvents,transactionWrites} from '../loc/db/db-client.mjs';
import {EDIT_OPERATION_TTL_MS,assertEditorSession,touchEditorSession,clearEditorSession} from '../loc/auth/edit-session-ttl.mjs';
import {isManagementHref} from './ScopeLink';
import {useQueryClient,releaseTransientPageResources} from '../../packages/zenstack/client-queries';
import {openEditorTransactionSession,cancelEditorTransactionSession}
  from '../loc/db/editor-transaction-lifecycle.mjs';
import {invalidateScopedReadCache} from '../../packages/zenstack/scoped-read-cache.mjs';
import {invalidateCachedReadPrefix} from '../loc/db/semi-dynamic-cache.mjs';

// UI only: a Scope's permission is checked before entering edit mode,
// and every write still passes through its existing database authorization.
const EditDockContext=createContext(null);

// The stale-chunk recovery helper runs outside React. Keep the live edit
// state visible to it without persisting form data, credentials or drafts.
function markEditorActive(active){
  try{
    const root=window.document?.documentElement;
    if(!root)return;
    if(active)root.dataset.locEditing='true';
    else delete root.dataset.locEditing;
  }catch{/* Document may be unavailable during root-layout failure. */}
}
function logCleanupFailure(failure){
  // onFailure hooks may carry SQL/internal context: do not log raw errors.
  const scrub=value=>{
    const text=String(value??'');
    return /^[A-Za-z0-9_.-]{1,64}$/.test(text)?text:null;
  };
  console.error('[LOC edit-dock] onFailure cleanup failed',{
    type:scrub(failure?.name)||'Error',code:scrub(failure?.code)
  });
}

export function EditDockProvider({children,scopeId}){
  const router=useRouter();
  const pathname=usePathname();
  const queryClient=useQueryClient();
  // Route-owned Scope ID is received from AppShell. Only editing is mutable.
  const [editing,setEditing]=useState(false);
  // A deliberate Cancel must not be interpreted by ManagementAccess as a
  // fresh request to enter editing while hard navigation is still pending.
  const [exiting,setExiting]=useState(false);
  const [canManageGlobal,setCanManageGlobal]=useState(false);
  const [hasSave,setHasSave]=useState(false);
  const [busy,setBusy]=useState(false);
  const committing=useRef(false);
  const operationEpoch=useRef(0);
  const operationTimer=useRef(null);
  const lastPathname=useRef(null);
  const releaseOperation=useCallback(()=>{
    operationEpoch.current++;
    if(operationTimer.current!==null)clearTimeout(operationTimer.current);
    operationTimer.current=null;
    committing.current=false;
    setBusy(false);
  },[]);
  const beginOperation=useCallback(()=>{
    const epoch=++operationEpoch.current;
    committing.current=true;
    setBusy(true);
    if(operationTimer.current!==null)clearTimeout(operationTimer.current);
    operationTimer.current=setTimeout(()=>{
      if(operationEpoch.current!==epoch)return;
      releaseOperation();
      setNotice('儲存操作超過 5 分鐘，操作鎖已解除。請確認資料是否成功寫入。');
    },EDIT_OPERATION_TTL_MS);
    return epoch;
  },[releaseOperation]);
  const finishOperation=useCallback(epoch=>{
    if(operationEpoch.current!==epoch)return false;
    releaseOperation();
    return true;
  },[releaseOperation]);
  const [notice,setNoticeState]=useState('');
  // Mirror of the visible notice so a failed editor Save can keep the specific
  // reason it reported instead of replacing it with a generic line.
  const noticeRef=useRef('');
  const setNotice=useCallback(value=>{noticeRef.current=String(value||'');setNoticeState(value);},[]);
  const switchHistory=useRef('replace');
  const switchScroll=useRef(true);
  const registeredEditors=useRef(new Set());
  const currentEditor=useRef(null);
  useEffect(()=>()=>{ // Provider unmount: release pending work and editor closures.
    if(operationTimer.current!==null)clearTimeout(operationTimer.current);
    operationTimer.current=null;
    operationEpoch.current++;
    committing.current=false;
    markEditorActive(false);
    registeredEditors.current.clear();
    currentEditor.current=null;
  },[]);

  const clearEditor=useCallback(()=>{
    registeredEditors.current.clear();
    currentEditor.current=null;
    setHasSave(false);
  },[]);
  const begin=useCallback((id,{globalManage=false}={})=>{
    const idText=String(id||'').trim();
    // Never activate an editor for a different page Scope. No Scope ID copy.
    if(!idText||idText!==scopeId||exiting)return false;
    if(idText!=='local'){
      // A rejected/expired browser Session is not permission to open a Dock.
      // Explicit LOC re-verification is responsible for restarting editing.
      try{if(!touchEditorSession(window.sessionStorage))return false}
      catch{return false}
    }
    // A verified new editing entry opens one fresh network/transaction epoch.
    // Old queued callbacks remain fenced by their captured generation.
    openEditorTransactionSession();
    markEditorActive(true);
    setEditing(true);
    setCanManageGlobal(Boolean(globalManage));
    setNotice('');
    return true;
  },[scopeId,exiting]);
  const end=useCallback(()=>{
    // All exits invalidate the active editor lease before any form callback
    // can resume. An ordinary tab/section switch does not call end().
    cancelEditorTransactionSession();
    markEditorActive(false);
    releaseOperation();
    clearEditor();
    setEditing(false);
    setCanManageGlobal(false);
    setNotice('');
  },[clearEditor,releaseOperation]);
  useEffect(()=>{
    if(lastPathname.current!==null&&pathname!==lastPathname.current)releaseOperation();
    lastPathname.current=pathname;
  },[pathname,releaseOperation]);
  useEffect(()=>{
    // Editing expiry must revoke only local editor UI. Never sign the user out
    // of LOC Auth because the independent edit-session clock elapsed.
    const expire=()=>end();
    window.addEventListener('loc-editor-session-expired',expire);
    return ()=>window.removeEventListener('loc-editor-session-expired',expire);
  },[end]);

  // A verified LOC Auth account change invalidates all editor UI permissions.
  // The backend independently authorizes each write using LOC Code grants.
  // Device-local SQLite editing is independent of cloud OAuth.
  useEffect(()=>{
    if(!editing)return undefined;
    let lastIdentity=null;
    const subscription=dbAuthEvents.onAuthStateChange((event,session)=>{
      const userId=String(session?.user?.id||'');
      const email=String(session?.user?.email||'').trim().toLowerCase();
      const identity=userId+'|'+email;
      const identityChanged=Boolean(userId)&&lastIdentity!==null&&lastIdentity!==identity;
      // An initial empty SDK event is not a sign-out from LOC Auth.
      // Editing ends only on a real sign-out or verified identity change.
      if(userId)lastIdentity=identity;
      else if(event==='SIGNED_OUT')lastIdentity=null;
      const invalidated=event==='SIGNED_OUT'||identityChanged;
      if(!invalidated)return;
      if(scopeId==='local'&&Capacitor.isNativePlatform())return;
      try{clearEditorSession(window.sessionStorage);}catch{}
      end();
    });
    return ()=>subscription.data.subscription.unsubscribe();
  },[end,editing,scopeId]);

  // Each mounted editor supplies the *current page's* save function.
  // Unmounting clears it only if no later editor has replaced it.
  const register=useCallback(actions=>{
    const editor={save:actions.save,prepareTransaction:actions.prepareTransaction,
      discard:actions.discard,isDirty:actions.isDirty,
      isBusy:actions.isBusy,isDestructive:actions.isDestructive};
    registeredEditors.current.add(editor);
    const activate=()=>{
      currentEditor.current=editor;
      setHasSave(typeof editor.save==='function');
      setNotice('');
    };
    // A page with multiple independent forms (Article and Suno) keeps the
    // first as default. Focusing another form explicitly replaces Save.
    if(!currentEditor.current)activate();
    const unregister=()=>{
      registeredEditors.current.delete(editor);
      if(currentEditor.current!==editor)return;
      currentEditor.current=registeredEditors.current.values().next().value||null;
      setHasSave(typeof currentEditor.current?.save==='function');
    };
    unregister.activate=activate;
    return unregister;
  },[]);

  const navigate=useCallback((target,history='replace',scroll=true)=>{
    if(!target)return;
    const url=new URL(String(target),window.location.href);
    // Static management exports need a real HTML entrypoint, not an App Router
    // Preserve a standard Next.js RSC transition for the current runtime.
    // Only the edit-session timestamp is stored, never form input or drafts.
    const documentExit=url.origin!==window.location.origin||
      /\/index\.html$/i.test(url.pathname)||isManagementHref(url.href);
    // Full-document navigation naturally disposes the old page and its
    // outstanding requests. Never flush global query/bootstrap state BEFORE
    // the browser commits the navigation: a slow/failed transition would
    // leave the live six-key homepage empty. SPA transitions instead clean
    // their outgoing readers in PageResourceBoundary after the route changes.
    if(documentExit){
      window.location.assign(url.href);
    }else{
      if(history==='push')router.push(url.pathname+url.search+url.hash,{scroll});
      else router.replace(url.pathname+url.search+url.hash,{scroll});
    }
  },[router]);
  const complete=useCallback(target=>{
    setExiting(true);
    end();
    navigate(target);
  },[end,navigate]);
  const save=useCallback(async({exitOnSuccess=false}={})=>{
    if(!editing||busy||committing.current)return;
    // A management section can mount independent Database / ISR / Email
    // editors simultaneously. Save every dirty editor through the existing
    // six-feature Save action; never silently save just the first mounted one.
    const dirty=[...registeredEditors.current].filter(editor=>editor.isDirty?.());
    const editors=dirty;
    if(!editors.length){
      setNotice('目前沒有待儲存的變更。');
      // On the homepage, Save also finishes editing. An unmounted or
      // not-yet-registered editor must not be mistaken for a clean form.
      if(exitOnSuccess&&registeredEditors.current.size>0)end();
      return;
    }
    if(editors.some(editor=>typeof editor.save!=='function')){
      setNotice('這個頁面尚未載入可儲存的編輯內容。');
      return;
    }
    if(editors.some(editor=>editor.isBusy?.())){
      setNotice('正在儲存其他設定，請完成後再操作。');
      return;
    }
    const epoch=beginOperation();
    setNotice('');
    try{
      if(scopeId!=='local')assertEditorSession(window.sessionStorage);
      if(editors.length>1&&editors.some(editor=>
        typeof editor.prepareTransaction!=='function')){
        // Never claim an atomic page Save if some editors would issue their
        // own independent HTTP requests and commit halfway through.
        setNotice('部分編輯器尚未支援同次交易；已保留全部修改，請分別儲存。');
        return;
      }
      if(editors.length>1&&editors.every(editor=>typeof editor.prepareTransaction==='function')){
        const prepared=[];
        try{
          for(const editor of editors){
            const plan=await editor.prepareTransaction();
            if(epoch!==operationEpoch.current)return;
            if(!plan||!Array.isArray(plan.operations))
              throw new Error('管理編輯器未提供完整的交易操作');
            prepared.push(plan);
          }
        }catch(error){
          if(epoch!==operationEpoch.current)return;
          for(const plan of prepared){
            if(epoch!==operationEpoch.current)return;
            // Preserve the original transaction failure and log only safe
            // metadata from a secondary cleanup failure.
            try{await plan.onFailure?.(error);}
            catch(cleanup){logCleanupFailure(cleanup);}
          }
          throw error;
        }
        try{
          const operations=prepared.flatMap(plan=>plan.operations);
          if(operations.length)await transactionWrites(operations);
        }catch(error){
          if(epoch!==operationEpoch.current)return;
          for(const plan of prepared){
            if(epoch!==operationEpoch.current)return;
            // Preserve the original transaction failure and log only safe
            // metadata from a secondary cleanup failure.
            try{await plan.onFailure?.(error);}
            catch(cleanup){logCleanupFailure(cleanup);}
          }
          throw error;
        }
        if(epoch!==operationEpoch.current)return;
        // Only after confirmed COMMIT may any form clear its draft.
        // A UI refresh failure cannot be mistaken for a SQL ROLLBACK.
        for(const plan of prepared){
          if(epoch!==operationEpoch.current)return;
          try{await plan.afterCommit?.();}
          catch(error){
            if(epoch!==operationEpoch.current)return;
            setNotice('資料已提交，但畫面更新失敗，請重新讀取。');
            return;
          }
        }
      }else{
        const saved=await editors[0].save();
        if(epoch!==operationEpoch.current)return;
        if(saved!==true){
          if(!noticeRef.current)setNotice('設定尚未儲存，已保留編輯內容。請檢查區塊提示。');
          return;
        }
      }
      if(epoch===operationEpoch.current&&dirty.length){
        // Confirmed Save is a targeted Refresh, not a global page wipe.
        // Block editors already published their exact saved rows via
        // setQueryData: never erase those values before React can display
        // them. Refresh only still-mounted, scope-owned data readers.
        // QueryClient deduplicates identical keys; no full-page reload.
        if(epoch!==operationEpoch.current)return;
        const refreshScope=String(scopeId||'');
        await queryClient.invalidateQueries({predicate:query=>{
          const parts=Array.isArray(query.queryKey)?query.queryKey:[];
          if(!parts.includes(refreshScope))return false;
          const family=String(parts[0]||'');
          // Auth, bootstrap (whose Blocks are patched immediately), and
          // live settings are handled by their own mutation callbacks.
          return !['app-bootstrap','scope-blocks','loc-account',
            'public-feature-flags'].includes(family);
        }});
        // Exit only when every dirty form returned confirmed success.
        // A failed write leaves current in-memory input mounted for correction.
        if(exitOnSuccess){end();return;}
        setNotice('目前修改已儲存。');
      }
    }catch(error){
      if(epoch===operationEpoch.current)setNotice(String(error?.message||'儲存失敗，請檢查內容。'));
    }finally{
      finishOperation(epoch);
    }
  },[editing,busy,scopeId,beginOperation,finishOperation,end,queryClient]);
  // Navigation is an explicit discard boundary: never retain a previous
  // section's draft, editor callbacks, operation lock, or query payloads.
  // Only pressing Save writes data. No modal or hidden Save queue on exit.
  const discard=useCallback(target=>{
    if(!target)return;
    const destination=new URL(String(target),window.location.href);
    // Block the management entry effect BEFORE ending the Dock. Previously
    // it immediately called begin() again after Cancel, making the six-key
    // buttons reappear if navigation took another frame or stalled.
    setExiting(true);
    end();
    // A single terminal cleanup for reads, cursors, partial results and
    // all queued retry/revalidation work. Do not revoke Better Auth, editor
    // Session TTL or grants; those are not transaction buffers.
    releaseTransientPageResources({discardEditor:true});
    invalidateScopedReadCache();
    invalidateCachedReadPrefix('scope-aggregate:');
    // Replace rather than push: Back must not return to a stale editing
    // screen that automatically requests management entry again.
    window.location.replace(destination.href);
  },[end]);
  const switchTo=useCallback((target,{history='replace',scroll=true}={})=>{
    if(!target)return;
    switchHistory.current=history==='push'?'push':'replace';
    switchScroll.current=scroll!==false;
    releaseOperation();
    clearEditor();setNotice('');
    navigate(target,switchHistory.current,switchScroll.current);
  },[releaseOperation,clearEditor,navigate]);
  const switchSection=useCallback((next,commit)=>{
    if(typeof commit!=='function')return;
    releaseOperation();
    clearEditor();setNotice('');
    // The section hook disposes the old query generation before it commits.
    commit(next);
  },[releaseOperation,clearEditor]);
  const value=useMemo(()=>({
    active:editing,exiting,scopeId,canManageGlobal,hasSave,busy,notice,begin,end,
    register,save,discard,complete,switchTo,switchSection,setNotice
  }),[editing,exiting,scopeId,canManageGlobal,hasSave,busy,notice,begin,end,register,save,discard,complete,switchTo,switchSection]);
  return <EditDockContext.Provider value={value}>{children}</EditDockContext.Provider>;
}

export function useEditDock(){return useContext(EditDockContext);}

// Registers a real editor with the existing Save / Discard / Cancel dock.
// Callbacks are kept current without re-registering on every keystroke.
export function useEditDockForm(actions){
  const dock=useEditDock();
  const latest=useRef(actions);
  const activation=useRef(null);
  latest.current=actions;
  useEffect(()=>{
    if(!dock?.register)return;
    const unregister=dock.register({
      save:options=>latest.current.save?.(options),
      prepareTransaction:latest.current.prepareTransaction
        ?()=>latest.current.prepareTransaction():undefined,
      discard:()=>latest.current.discard?.(),
      isDirty:()=>Boolean(latest.current.isDirty?.()),
      isBusy:()=>Boolean(latest.current.isBusy?.()),
      isDestructive:()=>Boolean(latest.current.isDestructive?.())
    });
    activation.current=unregister.activate;
    return ()=>{activation.current=null;unregister();};
  },[dock?.register]);
  // Optional: forms sharing a management page can activate the right Save target.
  return useCallback(()=>activation.current?.(),[]);
}
