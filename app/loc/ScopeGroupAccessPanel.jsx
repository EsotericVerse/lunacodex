'use client';
import {useEffect,useState} from 'react';
import {useUiText} from '../i18n/UiText';
import {useUiSection} from '../i18n/ui-locale';
import {registerDefaultSection} from '../i18n/ui-copy';
import scopeSettingsZh from '../i18n/sections/uiExtra.scopeSettings.zh_tw.js';
import {mcpLocSession} from './mcp/loc-access.mjs';
import {scopeGroupRequest} from './mcp/scope-group-client.mjs';
import {dbPublicClient} from './db-client.mjs';

registerDefaultSection('uiExtra.scopeSettings',scopeSettingsZh);

const ACTIONS=['read','write','configure','manage'];
export default function ScopeGroupAccessPanel({groupId}){
  useUiSection('uiExtra.scopeSettings');
  const ui=useUiText();
  const t=k=>ui('uiExtra.scopeSettings.'+k);
  const actionLabel=action=>ACTIONS.includes(action)
    ?t('groupAction'+action.charAt(0).toUpperCase()+action.slice(1)):action;
  const [data,setData]=useState(null);
  const [subject,setSubject]=useState('');
  const [scope,setScope]=useState('');
  const [newScope,setNewScope]=useState('');
  const [categoryUid,setCategoryUid]=useState('');
  const [publicClasses,setPublicClasses]=useState([]);
  const [classesLoading,setClassesLoading]=useState(false);
  const [classesError,setClassesError]=useState('');
  const [selected,setSelected]=useState(['read']);
  const [days,setDays]=useState(365);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const call=async(kind,values={})=>{
    const {token}=await mcpLocSession();
    return scopeGroupRequest({groupid:groupId,kind,token,...values});
  };
  const reload=async()=>{
    const result=await call('list');
    setData(result);
    setScope(current=>result.members.includes(current)?current:
      (result.members.find(x=>x!==groupId)||groupId));
  };
  useEffect(()=>{
    let active=true;
    setLoading(true);setStatus('');setData(null);
    call('list').then(result=>{
      if(active){setData(result);setScope(result.members.find(x=>x!==groupId)||groupId);}
    }).catch(()=>{if(active)setStatus(t('groupLoadFailed'));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[groupId]);
  useEffect(()=>{
    if(!data||!scope||scope===groupId){setPublicClasses([]);setCategoryUid('');return;}
    let active=true;
    setClassesLoading(true);setClassesError('');setCategoryUid('');
    // SQL only returns published type=class nodes from the selected Scope's
    // own Keywords table. Group/Item identifiers are never included.
    dbPublicClient.schema('silver').analytics({
      p_scope_id:scope,p_view:'shared_classes',p_start:null,p_end:null,p_options:{}
    })
      .then(({data:rows,error})=>{
        if(!active)return;
        if(error)throw error;
        setPublicClasses((Array.isArray(rows)?rows:[])
          .filter(row=>row.scopeId===scope&&/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(row.classUid)));
      }).catch(()=>{if(active){setPublicClasses([]);setClassesError('目前無法查詢已公開的群組科目，請稍後再試。');}})
      .finally(()=>{if(active)setClassesLoading(false);});
    return()=>{active=false;};
  },[data?.members?.join(','),scope,groupId]);
  const submit=async(kind,values,success)=>{
    if(busy)return;
    setBusy(true);setStatus('');
    try{await call(kind,values);await reload();setStatus(t(success));}
    catch{setStatus(t('groupSaveFailed'));}
    finally{setBusy(false);}
  };
  const toggle=action=>setSelected(previous=>previous.includes(action)?
    previous.filter(x=>x!==action):[...previous,action]);
  const updateCategory=async(kind,scopeid,classUid)=>{
    if(busy||!scopeid||!/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(classUid))return;
    setBusy(true);setStatus('');
    try{
      if(kind==='categoryAdd'){
        // Validate against the public Class-only directory; no Group or Item
        // and no private Class may be browsed from this Group UI.
        if(!publicClasses.some(row=>row.classUid===classUid))
          throw new Error('只能加入這個資料來源已公開的群組科目。');
      }
      await call(kind,{scopeid,classUid});
      await reload();
      if(kind==='categoryAdd')setCategoryUid('');
      setStatus(kind==='categoryAdd'?'已將群組科目加入目錄。':'已從目錄移除群組科目。');
    }catch{setStatus('目前無法更新群組關鍵字目錄，請稍後再試。');}
    finally{setBusy(false);}
  };
  return <section className="loc-card scope-feature-card" aria-label={t('groupTitle')}>
    <h2>{t('groupTitle')}</h2>
    <p className="scope-status">{t('groupIntro')}</p>
    {loading?<p role="status" className="scope-status">{t('groupLoading')}</p>:null}
    {data?<>
      <div className="scope-management-fields">
        <label><span>{t('groupMemberScope')}</span>
          <select className="scope-select" value={scope} onChange={e=>setScope(e.target.value)}>
            {data.members.map(id=><option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label><span>{t('groupLocSubject')}</span>
          <input value={subject} onChange={e=>setSubject(e.target.value.trim())}
            autoCapitalize="off" spellCheck={false} placeholder="loc_..."/>
        </label>
        <label><span>{t('groupExpires')}</span>
          <input type="number" min={1} max={365} value={days}
            onChange={e=>setDays(Number(e.target.value))}/>
        </label>
        <fieldset className="scope-management-wide-field">
          <legend>{t('groupPermissions')}</legend>
          <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
            {ACTIONS.map(action=><label key={action} style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <input type="checkbox" checked={selected.includes(action)}
                onChange={()=>toggle(action)}/>{actionLabel(action)}
            </label>)}
          </div>
        </fieldset>
        <div className="scope-management-wide-field">
          <button type="button" className="loc-button" disabled={busy||!/^loc_[A-Za-z0-9_-]{32,80}$/.test(subject)||!selected.length}
            onClick={()=>submit('grant',{scopeid:scope,subject,actions:selected,days},'groupGranted')}>
            {t('groupGrant')}
          </button>
        </div>
      </div>
      <h3>{t('groupCurrentGrants')}</h3>
      {data.grants.length===0?<p className="scope-status">{t('groupNoGrants')}</p>:
        <div className="scope-management-fields">
          {data.grants.map(grant=><div className="scope-management-wide-field" key={grant.key}
            style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <span><strong>{grant.scope}</strong> · {grant.subject}</span>
            <span className="scope-status">{grant.actions.map(actionLabel).join(', ')} · {new Date(grant.expires_at).toLocaleDateString()}</span>
            <button type="button" className="loc-button" disabled={busy}
              onClick={()=>{
                if(globalThis.confirm?.(t('groupConfirmRevoke')))
                  void submit('revoke',{scopeid:grant.scope,subject:grant.subject},'groupRevoked');
              }}>{t('groupRevoke')}</button>
          </div>)}
        </div>}
      <h3>群組關鍵字目錄</h3>
      <p className="scope-status">只顯示成員已公開的關鍵字群組科目。加入目錄不會搬移文章；分類群組與判斷詞不能直接加入。</p>
      <div className="scope-management-fields">
        <label><span>選擇來源資料</span>
          <select className="scope-select" value={scope} onChange={event=>setScope(event.target.value)}>
            {data.members.filter(id=>id!==groupId).map(id=><option key={id} value={id}>{id}</option>)}
          </select></label>
        <label><span>已公開的關鍵字群組科目</span>
          <select className="scope-select" value={categoryUid}
            disabled={classesLoading||!publicClasses.length}
            onChange={event=>setCategoryUid(event.target.value)}>
            <option value="">{classesLoading?'正在核對公開科目…':'請選擇已公開的群組科目'}</option>
            {publicClasses.map(row=><option key={row.classUid} value={row.classUid}>
              {row.name}／{row.classUid}
            </option>)}
          </select></label>
        {classesError?<p className="scope-status scope-error" role="alert">{classesError}</p>:null}
        {!classesLoading&&!classesError&&!publicClasses.length
          ?<p className="scope-status">此資料來源沒有可加入的公開群組科目。</p>:null}
        <div className="scope-management-wide-field">
          <button type="button" className="loc-button"
            disabled={busy||classesLoading||!publicClasses.some(row=>row.classUid===categoryUid)}
            onClick={()=>updateCategory('categoryAdd',scope,categoryUid)}>加入選取的群組科目</button>
        </div>
      </div>
      {(data.categories||[]).length
        ?<div className="scope-management-fields">
          {data.categories.map(entry=><div className="scope-management-wide-field" key={entry.sha}
            style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <span><strong>{entry.scopeid}</strong>／<code>{entry.class}</code></span>
            <span className="scope-status" title={entry.sha}>資料版本：<code>{entry.sha.slice(0,12)}…</code></span>
            <button type="button" className="loc-button" disabled={busy}
              onClick={()=>updateCategory('categoryRemove',entry.scopeid,entry.class)}>移除</button>
          </div>)}
        </div>
        :<p className="scope-status">尚未加入任何群組科目。</p>}
      <h3>{t('groupLinkTitle')}</h3>
      <p className="scope-status">{t('groupLinkIntro')}</p>
      <div className="scope-management-fields">
        <label><span>{t('groupNewScope')}</span><input value={newScope}
          onChange={e=>setNewScope(e.target.value.toLowerCase().trim())}
          autoCapitalize="off" spellCheck={false}/></label>
        <button type="button" className="loc-button" disabled={busy||!newScope}
          onClick={()=>submit('join',{scopeid:newScope},'groupLinked')}>{t('groupLink')}</button>
      </div>
    </>:null}
    {status?<p className="scope-status" role="status">{status}</p>:null}
  </section>;
}
