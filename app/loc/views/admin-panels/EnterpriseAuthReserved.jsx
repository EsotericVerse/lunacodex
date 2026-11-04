'use client';
import {useEffect,useState} from 'react';
import {useEditDockForm} from '../../../modular/edit-dock';
import {AUTH_PROVIDER_FIELDS,AUTH_PROVIDER_LABELS,AUTH_PROVIDER_TYPES}
  from '../../auth/auth-provider-settings.mjs';
import {authProviderSettingsRequest} from '../../mcp/auth-provider-client.mjs';

const EMPTY=Object.freeze({});
function publicFields(profile){
  if(!profile)return {};
  const result={};
  for(const field of AUTH_PROVIDER_FIELDS[profile.type]||[]){
    if(field.kind!=='secret')result[field.key]=profile[field.key]||'';
  }
  return result;
}
export default function EnterpriseAuthReserved(){
  const [selected,setSelected]=useState('clerk');
  const [saved,setSaved]=useState({});
  const [draft,setDraft]=useState({});
  const [secret,setSecret]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [active,setActive]=useState('clerk');
  useEffect(()=>{
    let live=true;
    authProviderSettingsRequest().then(data=>{
      if(!live)return;
      const profiles={};
      for(const p of data.providers||[])if(AUTH_PROVIDER_TYPES.includes(p.type))
        profiles[p.type]=p;
      setSaved(profiles);setActive(data.active||'clerk');
    }).catch(error=>{if(live)setStatus(error.message||'認證設定無法讀取。');})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[]);
  const profile=saved[selected]||null;
  const hasSecret=Boolean(AUTH_PROVIDER_FIELDS[selected]?.some(field=>field.kind==='secret'));
  const current={...publicFields(profile),...draft};
  const dirty=selected!=='clerk'&&(
    Boolean(secret)||AUTH_PROVIDER_FIELDS[selected]?.some(field=>
      field.kind!=='secret'&&String(current[field.key]||'')!==String(profile?.[field.key]||'')));
  const selectProvider=next=>{
    if(next===selected||busy)return;
    if(dirty&&!window.confirm('認證來源設定尚未儲存，確定放棄嗎？'))return;
    setSelected(next);setDraft({});setSecret('');setStatus('');
  };
  const save=async()=>{
    if(selected==='clerk'||!dirty)return true;
    if(busy)return false;
    setBusy(true);setStatus('');
    try{
      const values={};
      for(const field of AUTH_PROVIDER_FIELDS[selected])
        values[field.key]=field.kind==='secret'?secret:String(current[field.key]||'');
      const updated=await authProviderSettingsRequest({type:selected,values});
      if(!updated||updated.type!==selected||updated.active)
        throw new Error('認證設定回傳狀態不正確。');
      setSaved(prev=>({...prev,[selected]:updated}));
      setDraft({});setSecret('');
      setStatus('連線參數已安全儲存。尚未啟用這個登入來源；現行 Clerk 不變。');
      return true;
    }catch(error){setStatus(error.message||'儲存失敗，原認證來源維持不變。');return false;}
    finally{setBusy(false);}
  };
  useEditDockForm({isBusy:()=>busy,isDirty:()=>Boolean(dirty),save});
  return <section className="loc-card admin-workspace" aria-labelledby="enterprise-auth-heading">
    <h2 id="enterprise-auth-heading">認證來源設定</h2>
    <p>集中管理 LOC 的登入來源連線參數。認證後的 LOC Authority／Scope 權限與資料庫設定彼此獨立。</p>
    <p className="scope-status" role="status">目前正式登入：{active==='clerk'?'Clerk':active}。
      未完成完整登入／Session 驗證的來源不可切換，避免管理員遭鎖在系統外。</p>
    <div className="scope-management-fields">
      <label><span>設定認證來源</span>
        <select className="admin-native-select" value={selected} disabled={busy}
          onChange={e=>selectProvider(e.target.value)}>
          <option value="clerk">Clerk（目前使用）</option>
          {AUTH_PROVIDER_TYPES.map(type=><option key={type} value={type}>
            {AUTH_PROVIDER_LABELS[type]}</option>)}
        </select>
      </label>
    </div>
    {selected==='clerk'?<p className="scope-status">Clerk 的現有金鑰由部署環境管理；
      此頁不顯示或覆寫它們，也不會影響正在使用的 Session。</p>:<>
      <h3 className="admin-workspace-section-heading">{AUTH_PROVIDER_LABELS[selected]} 連線參數</h3>
      <p className="scope-status">{profile?.configured?'參數已儲存':'尚未設定'}。
        {hasSecret?(profile?.secret_configured?' Secret 已安全保存；留空即保留原值。':' 第一次儲存需要 Client Secret。'):' Neon Auth 憑證由 Neon 服務管理，LOC 只保存連線端點。'}</p>
      {selected==='neon'?<p className="scope-status">Neon Auth 必須由管理員手動設定及測試連線；此處不切換登入來源，也不修改主要／備援資料庫連線。</p>:null}
      {(selected==='ldap'||selected==='ad')?<p className="scope-status">
        企業內部 LDAP／AD 透過組織管理的 OIDC 身分橋接服務連線；
        不在瀏覽器收集網域帳密、Bind Password 或直接連線至內部目錄。</p>:null}
      <div className="scope-management-fields">
        {AUTH_PROVIDER_FIELDS[selected].map(field=><label key={field.key}>
          <span>{field.label}</span>
          <input type={field.kind==='secret'?'password':field.kind==='url'?'url':'text'}
            autoComplete="off" spellCheck={false} maxLength={field.kind==='secret'?4096:512}
            value={field.kind==='secret'?secret:String(current[field.key]||'')}
            placeholder={field.kind==='secret'&&profile?.secret_configured?'留空保留已儲存的 Secret':''}
            disabled={busy||loading} onChange={event=>{
              if(field.kind==='secret')setSecret(event.target.value);
              else setDraft(prev=>({...prev,[field.key]:event.target.value}));
            }}/>
        </label>)}
      </div>
      <p className="scope-status">Secret 只透過授權的 LOC Authority 傳送並加密保存；
        重新讀取時僅顯示是否已設定，不會取回明文。</p>
      <button type="button" className="loc-button" onClick={()=>void save()}
        disabled={busy||loading||!dirty}>{busy?'儲存中…':'儲存連線設定'}</button>
      <p className="scope-status">目前為連線設定功能，尚未接通此來源的登入、回呼及 LOC Session。
        儲存成功不表示可以登入；啟用切換前必須完成端到端驗證。</p>
    </>}
    {status?<p role="status" className="scope-status">{status}</p>:null}
  </section>;
}
