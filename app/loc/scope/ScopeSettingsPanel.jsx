'use client';
import {useUiSection} from '../../i18n/ui-locale';
import UiText,{useUiText} from '../../i18n/UiText';

import {useEffect,useRef,useState} from 'react';
import {THEME_SLOTS} from '../../modular/theme-registry';
import {invalidatePublicScopeMetadata,selectScopeConfig} from './scope-data';
import {transactionWrites} from '../db/db-client.mjs';
import {useAccount} from '../auth/use-account';
import {useEditDock} from '../../modular/edit-dock';

const EMPTY={theme:'system-default'};

export default function ScopeSettingsPanel({scopeId}){
  useUiSection('uiExtra.scopeSettings');
  const uiT=useUiText();
  const account=useAccount();
  const editDock=useEditDock();
  const dockActions=useRef(null);
  const [savedTheme,setSavedTheme]=useState('system-default');
  const [draft,setDraft]=useState(EMPTY);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    let active=true;
    setLoading(true);setMessage('');
    selectScopeConfig(scopeId).then(row=>{
      if(!active)return;
      const theme=row?.theme||'system-default';
      setSavedTheme(theme);
      setDraft({theme});
    }).catch(error=>{
      if(active)setMessage(error?.message||uiT('uiExtra.scopeSettings.loadFailed'));
    }).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false};
  },[scopeId]);

  useEffect(()=>{
    if(!editDock?.active||editDock.scopeId!==scopeId||!account.canLocAccessSync('scope',scopeId))return undefined;
    return editDock.register({
      save:()=>dockActions.current.save(),
      prepareTransaction:()=>dockActions.current.prepareTransaction(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[editDock?.active,editDock?.scopeId,editDock?.register,scopeId,account.role]);
  if(!account.canLocAccessSync('scope',scopeId))return null;
  const table=account.scopeDataFor(scopeId)?.config;
  const change=(key,value)=>setDraft(current=>({...current,[key]:value}));

  function prepareThemeTransaction(){
    if(busy||loading)throw Error('主題資料尚未就緒');
    if(!table)throw new Error(uiT('uiExtra.scopeSettings.unavailable'));
    const nextTheme=String(draft.theme||'system-default');
    return {
      operations:[{p_table:table,p_operation:'update',
        p_values:{theme:nextTheme,updated_at:new Date().toISOString()},
        p_filters:[{column:'id',operator:'eq',value:scopeId}]}],
      afterCommit:()=>{
        // A confirmed count from the same transaction is the Save receipt.
        // Do not open another SQL connection simply to SELECT the new value.
        setSavedTheme(nextTheme);
        invalidatePublicScopeMetadata();
        if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(
          'loc-scope-theme-saved',{detail:{scopeId,themeId:nextTheme}}));
        setMessage(uiT('uiExtra.scopeSettings.saved'));
      },
      onFailure:error=>setMessage(error?.message||uiT('uiExtra.scopeSettings.saveFailed'))
    };
  }
  async function save(event){
    event?.preventDefault?.();
    if(busy||loading)return false;
    setBusy(true);setMessage('');
    try{
      const plan=prepareThemeTransaction();
      await transactionWrites(plan.operations);
      await plan.afterCommit();
      return true;
    }catch(error){
      setMessage(error?.message||uiT('uiExtra.scopeSettings.saveFailed'));
      return false;
    }finally{setBusy(false);}
  }

  // Loading the current theme is not a pending database write.
  dockActions.current={save:()=>save(),prepareTransaction:()=>prepareThemeTransaction(),isDirty:()=>!loading&&draft.theme!==savedTheme,isBusy:()=>busy};
  return <><section className="loc-card scope-feature-card">
    <h3>選擇主題</h3>
    {loading?<p className="scope-status"><UiText id="common.loading"/></p>:null}
    {!loading?<div>
      <div className="scope-management-fields">
        <label>
          <span><UiText id="common.theme"/></span>
          <select className="scope-select" value={draft.theme||'system-default'} onChange={event=>change('theme',event.target.value)}>
            <option value="system-default"><UiText id="uiExtra.scopeSettings.systemDayNight"/></option>
            {THEME_SLOTS.map(theme=><option value={theme.id} key={theme.id}>{theme.label}</option>)}
          </select>
        </label>
      </div>

      {message?<p className="scope-status" role="status">{message}</p>:null}
    </div>:null}
  </section></>;
}
