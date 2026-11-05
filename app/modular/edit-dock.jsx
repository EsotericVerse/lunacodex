'use client';

import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {Capacitor} from '@capacitor/core';
import {dbAuthEvents} from '../loc/db-client.mjs';
import {EDIT_OPERATION_TTL_MS,assertEditorSession,touchEditorSession,clearEditorSession} from '../loc/edit-session-ttl.mjs';
import {clearHomeEditorAccess} from '../loc/home-edit-access.mjs';
import {isManagementHref} from './ScopeLink';

// UI only: a Scope's permission is checked before entering edit mode,
// and every write still passes through its existing database authorization.
const EditDockContext=createContext(null);

export function EditDockProvider({children}){
  const router=useRouter();
  const pathname=usePathname();
  const [scopeId,setScopeId]=useState('');
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
      setSwitchError('儲存操作逾時，尚未確認寫入狀態；可以取消返回。');
    },EDIT_OPERATION_TTL_MS);
    return epoch;
  },[releaseOperation]);
  const finishOperation=useCallback(epoch=>{
    if(operationEpoch.current!==epoch)return false;
    releaseOperation();
    return true;
  },[releaseOperation]);
  const [notice,setNotice]=useState('');
  const [switchTarget,setSwitchTarget]=useState('');
  const [switchError,setSwitchError]=useState('');
  const switchDialog=useRef(null);
  const switchHistory=useRef('replace');
  const switchScroll=useRef(true);
  // A management selection changes mounted React content, not the URL route.
  const pendingSectionAction=useRef(null);
  const registeredEditors=useRef(new Set());
  const currentEditor=useRef(null);

  useEffect(()=>{
    const dialog=switchDialog.current;
    if(!dialog)return;
    if(switchTarget&&!dialog.open)dialog.showModal();
    if(!switchTarget&&dialog.open)dialog.close();
  },[switchTarget]);

  const clearEditor=useCallback(()=>{
    registeredEditors.current.clear();
    currentEditor.current=null;
    setHasSave(false);
  },[]);
  const begin=useCallback((id,{globalManage=false}={})=>{
    const idText=String(id||'').trim();
    if(!idText)return;
    if(idText!=='local')try{touchEditorSession(window.sessionStorage);}catch{}
    setScopeId(idText);
    setCanManageGlobal(Boolean(globalManage));
    setNotice('');
  },[]);
  const end=useCallback(()=>{
    try{clearHomeEditorAccess(window.sessionStorage);}catch{}
    releaseOperation();
    clearEditor();
    pendingSectionAction.current=null;
    setSwitchTarget('');
    setSwitchError('');
    setScopeId('');
    setCanManageGlobal(false);
    setNotice('');
  },[clearEditor,releaseOperation]);
  useEffect(()=>{
    if(lastPathname.current!==null&&pathname!==lastPathname.current)releaseOperation();
    lastPathname.current=pathname;
  },[pathname,releaseOperation]);
  useEffect(()=>{
    // Editing expiry must revoke only local editor UI. Never sign the user out
    // of Google/Supabase because the independent edit-session clock elapsed.
    const expire=()=>end();
    window.addEventListener('loc-editor-session-expired',expire);
    return ()=>window.removeEventListener('loc-editor-session-expired',expire);
  },[end]);
  useEffect(()=>{
    if(!scopeId||scopeId==='local')return undefined;
    const activity=()=>{try{touchEditorSession(window.sessionStorage);}catch{}};
    window.addEventListener('pointerdown',activity,{passive:true});
    window.addEventListener('keydown',activity,{passive:true});
    return ()=>{
      window.removeEventListener('pointerdown',activity);
      window.removeEventListener('keydown',activity);
    };
  },[scopeId]);

  // A Google OAuth account change invalidates all editor UI permissions.
  // The backend still authorizes each write using the active JWT/RLS.
  // Device-local SQLite editing is independent of cloud OAuth.
  const activeScope=useRef('');
  activeScope.current=scopeId;
  useEffect(()=>{
    let lastIdentity=null;
    const subscription=dbAuthEvents.onAuthStateChange((event,session)=>{
      const userId=String(session?.user?.id||'');
      const email=String(session?.user?.email||'').trim().toLowerCase();
      const identity=userId+'|'+email;
      const identityChanged=Boolean(userId)&&lastIdentity!==null&&lastIdentity!==identity;
      // An initial unverified/empty SDK event on a fresh HTML page is not a
      // sign-out from an active editor. Avoid clearing the cross-page editor
      // entry marker before the first Clerk verification can finish.
      if(userId)lastIdentity=identity;
      else if(event==='SIGNED_OUT')lastIdentity=null;
      const invalidated=event==='SIGNED_OUT'||identityChanged;
      if(!invalidated||!activeScope.current)return;
      if(activeScope.current==='local'&&Capacitor.isNativePlatform())return;
      try{clearEditorSession(window.sessionStorage);}catch{}
      end();
    });
    return ()=>subscription.data.subscription.unsubscribe();
  },[end]);

  // Each mounted editor supplies the *current page's* save function.
  // Unmounting clears it only if no later editor has replaced it.
  const register=useCallback(actions=>{
    const editor={save:actions.save,discard:actions.discard,isDirty:actions.isDirty,
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
    // RSC transition: Cloudflare Pages does not serve that dynamic RSC request.
    // The authorized editor state is restored from sessionStorage on entry.
    if(url.origin!==window.location.origin||/\/index\.html$/i.test(url.pathname)||
      isManagementHref(url.href)){
      window.location.assign(url.href);
    }else{
      if(history==='push')router.push(url.pathname+url.search+url.hash,{scroll});
      else router.replace(url.pathname+url.search+url.hash,{scroll});
    }
  },[router]);
  const complete=useCallback(target=>{
    end();
    navigate(target);
  },[end,navigate]);
  const save=useCallback(async()=>{
    if(busy||committing.current)return;
    // A management section can mount independent Database / ISR / Email
    // editors simultaneously. Save every dirty editor through the existing
    // six-feature Save action; never silently save just the first mounted one.
    const dirty=[...registeredEditors.current].filter(editor=>editor.isDirty?.());
    const editors=dirty;
    if(!editors.length){
      setNotice('目前沒有待儲存的變更。');
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
      for(const editor of editors){
        const saved=await editor.save();
        if(epoch!==operationEpoch.current)return;
        if(saved!==true)throw new Error('部分設定未儲存，已保留編輯內容。請檢查各區塊提示。');
      }
      if(epoch===operationEpoch.current&&dirty.length)
        setNotice('目前修改已儲存。');
    }catch(error){
      if(epoch===operationEpoch.current)setNotice(String(error?.message||'儲存失敗，請檢查內容。'));
    }finally{
      finishOperation(epoch);
    }
  },[busy,scopeId,beginOperation,finishOperation]);
  const dirtyEditors=useCallback(()=>[...registeredEditors.current].filter(editor=>
    typeof editor.isDirty==='function'&&editor.isDirty()
  ),[]);
  const discard=useCallback((target,{confirmOnlyWhenDirty=false}={})=>{
    if(!target)return;
    // An explicit Cancel must always escape a stalled Save lock.
    if(!busy&&(!confirmOnlyWhenDirty||dirtyEditors().length)&&
      !window.confirm(confirmOnlyWhenDirty
        ?'確定放棄尚未儲存的變更並返回普通頁面？'
        :'確定放棄尚未儲存的編輯並返回首頁？'))return;
    const destination=new URL(String(target),window.location.href);
    end();
    // Leaving a static management entrypoint needs a real document navigation.
    // App Router replace may update the dock but leave the management page mounted.
    window.location.assign(destination.href);
  },[busy,dirtyEditors,end]);
  // Every mounted form reports its own unsaved state; a focused form is not
  // necessarily the only edited one on a management page.
  const switchTo=useCallback((target,{history='replace',scroll=true}={})=>{
    pendingSectionAction.current=null;
    if(busy||!target)return;
    if([...registeredEditors.current].some(editor=>editor.isBusy?.())){
      setNotice('目前正在儲存，請完成後再切換頁面。');
      return;
    }
    switchHistory.current=history==='push'?'push':'replace';
    switchScroll.current=scroll!==false;
    if(!dirtyEditors().length){
      clearEditor();setNotice('');navigate(target,switchHistory.current,switchScroll.current);return;
    }
    setSwitchError('');
    setSwitchTarget(target);
  },[busy,dirtyEditors,clearEditor,navigate]);
  const switchSection=useCallback((next,commit)=>{
    if(busy||typeof commit!=='function')return;
    if([...registeredEditors.current].some(editor=>editor.isBusy?.())){
      setNotice('目前正在儲存，請完成後再切換。');
      return;
    }
    const apply=()=>commit(next);
    if(!dirtyEditors().length){
      pendingSectionAction.current=null;
      clearEditor();setNotice('');
      apply();
      return;
    }
    // Reuse the existing Save/Discard/Cancel dialog, without router.push.
    pendingSectionAction.current=apply;
    setSwitchError('');
    setSwitchTarget('management-section:'+String(next));
  },[busy,dirtyEditors,clearEditor]);
  const cancelSwitch=useCallback(()=>{
    releaseOperation();
    pendingSectionAction.current=null;
    setSwitchTarget('');
    setSwitchError('');
  },[releaseOperation]);
  const discardAndSwitch=useCallback(()=>{
    if(busy||!switchTarget)return;
    const target=switchTarget;
    const action=pendingSectionAction.current;
    pendingSectionAction.current=null;
    setSwitchTarget('');setSwitchError('');
    clearEditor();setNotice('');
    if(action)action();
    else navigate(target,switchHistory.current,switchScroll.current);
  },[busy,switchTarget,clearEditor,navigate]);
  const value=useMemo(()=>({
    active:Boolean(scopeId),scopeId,canManageGlobal,hasSave,busy,notice,begin,end,
    register,save,discard,complete,switchTo,switchSection,setNotice
  }),[scopeId,canManageGlobal,hasSave,busy,notice,begin,end,register,save,discard,complete,switchTo,switchSection]);
  return <EditDockContext.Provider value={value}>
    {children}
    <dialog ref={switchDialog} className="scope-edit-switch-dialog" aria-labelledby="scope-edit-switch-title"
      aria-describedby="scope-edit-switch-description"
      onCancel={event=>{event.preventDefault();cancelSwitch();}}>
      <h2 id="scope-edit-switch-title">有未儲存的編輯內容</h2>
      <p id="scope-edit-switch-description">有未儲存的變更；請先使用固定六鍵的「儲存」，或選擇放棄變更。</p>
      {[...registeredEditors.current].some(editor=>editor.isDirty?.()&&editor.isDestructive?.())
        ?<p className="scope-status" role="status">此儲存包含合併地點或大量可見性更新；合併會將來源地點的文章、路線關聯轉至主要 UID，並刪除來源 UID。請使用固定六鍵的「儲存」確認執行。</p>:null}
      {switchError?<p role="alert" className="scope-status scope-error">{switchError}</p>:null}
      <div className="scope-edit-switch-actions">
        <button type="button" className="loc-button" disabled={busy} onClick={discardAndSwitch}>放棄變更</button>
        <button type="button" className="loc-button" onClick={cancelSwitch}>取消</button>
      </div>
    </dialog>
  </EditDockContext.Provider>;
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
