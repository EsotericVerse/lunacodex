'use client';

import {useState} from 'react';
import UiText from '../i18n/UiText';
import {useUiSection} from '../i18n/ui-locale';
import {registerDefaultSection} from '../i18n/ui-copy';
import editBlocksZh from '../i18n/sections/uiExtra.editBlocks.zh_tw.js';
registerDefaultSection('uiExtra.editBlocks',editBlocksZh);
import {useScopeRuntime} from '../modular/use-scope-runtime';
import {useEditDock} from '../modular/edit-dock';
import {useAccount} from './use-account';
import {clearEditorSession} from './edit-session-ttl.mjs';

// This control is shown only at the bottom of an individual Scope homepage.
// No identity or management query runs until the visitor selects it.
export default function ScopeHomeEditEntry(){
  useUiSection('uiExtra.editBlocks');
  const {scopeId}=useScopeRuntime();
  const account=useAccount({enabled:false});
  const editDock=useEditDock();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');


  async function enter(){
    if(busy)return;
    setBusy(true);
    setMessage('');
    try{
      if(scopeId==='local'){
        setMessage({error:'Local Scope 尚未啟用，請先設定資料庫引擎。'});
        return;
      }
      // One live verification for this edit entry. An earlier result is not
      // used to bypass authorization; writes remain protected by server RLS.
      const result=await account.refresh();
      if(!result?.user){
        setMessage({key:'uiExtra.editBlocks.signInToEnterEditMode',showLogin:true});
        return;
      }
      // The LOC homepage belongs to the LOC Group. Its own active
      // loc:manage role may edit index Blocks; global Admin is required only
      // for system-wide settings and non-homepage LOC resources.
      const allowed=result.authorizer?.canManageScopeSync(scopeId);
      if(!allowed){
        setMessage({key:'uiExtra.editBlocks.editPermissionDenied'});
        return;
      }
      // A new verified edit entry starts a fresh 30-minute idle / 2-hour
      // edit session; otherwise a previously locked session can never reopen.
      clearEditorSession(window.sessionStorage);
      // The route owns Scope ID. Entering edit mode only toggles the Dock;
      // nothing is copied to sessionStorage or saved for later restoration.
      editDock?.begin(scopeId,{globalManage:Boolean(result.authorizer?.canManageGlobalSync())});
    }catch(error){
      setMessage({error:String(error?.message||'編輯權限查詢失敗，請檢查登入或資料庫連線。')});
    }finally{
      setBusy(false);
    }
  }

  if(editDock?.active&&editDock.scopeId===scopeId)return null;
  return <div className="scope-home-edit-entry">
    <button type="button" className="loc-button" disabled={busy}
      onClick={enter}><UiText id={busy?'uiExtra.editBlocks.checkingEditPermission':'uiExtra.editBlocks.enterEditMode'}/></button>
    {message?<div className="scope-status" role="status">
      <p>{message.error||<UiText id={message.key}/>}</p>
      {message.showLogin?<p><a href="/local/settings/">前往設定首頁使用 LOC Auth 登入</a></p>:null}
    </div>:null}
  </div>;
}
