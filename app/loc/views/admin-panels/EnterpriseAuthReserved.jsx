'use client';
import {useEffect,useState} from 'react';
import {useEditDockForm} from '../../../modular/edit-dock';
import {AUTH_PROVIDER_FIELDS,AUTH_PROVIDER_LABELS,AUTH_PROVIDER_TYPES}
  from '../../auth/auth-provider-settings.mjs';
import {authProviderSettingsRequest} from '../../mcp/auth-provider-client.mjs';

// The Admin shell owns the page width, tablet breakpoints and Save / Discard
// buttons. Reuse the same selector and two-column fields as the other panels.
const PROVIDER_OPTIONS=Object.freeze([
  {value:'loc',label:'LOC Auth（目前登入）'},
  ...AUTH_PROVIDER_TYPES.map(type=>({value:type,label:AUTH_PROVIDER_LABELS[type]}))
]);
function publicFields(profile){
  const result={};
  for(const field of AUTH_PROVIDER_FIELDS[profile?.type]||[]){
    if(field.kind!=='secret')result[field.key]=profile[field.key]||'';
  }
  return result;
}
export default function EnterpriseAuthReserved(){
  const [selected,setSelected]=useState('loc');
  const [saved,setSaved]=useState({});
  const [draft,setDraft]=useState({});
  const [secret,setSecret]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [active,setActive]=useState('loc');
  useEffect(()=>{
    let live=true;
    authProviderSettingsRequest().then(data=>{
      if(!live)return;
      const profiles={};
      for(const provider of data.providers||[]){
        if(AUTH_PROVIDER_TYPES.includes(provider.type))profiles[provider.type]=provider;
      }
      setSaved(profiles);
      setActive(data.active||'loc');
    }).catch(error=>{
      if(live)setStatus(error.message||'認證設定讀取失敗。');
    }).finally(()=>{if(live)setLoading(false)});
    return()=>{live=false};
  },[]);

  const profile=saved[selected]||null;
  const fields=AUTH_PROVIDER_FIELDS[selected]||[];
  const hasSecret=fields.some(field=>field.kind==='secret');
  const current={...publicFields(profile),...draft};
  const dirty=selected!=='loc'&&(Boolean(secret)||fields.some(field=>
    field.kind!=='secret'&&String(current[field.key]||'')!==String(profile?.[field.key]||'')));

  const discard=()=>{
    setDraft({});
    setSecret('');
    setStatus('');
  };
  const selectProvider=next=>{
    if(next===selected||busy)return;
    if(dirty&&!window.confirm('認證來源欄位尚未儲存，確定放棄修改？'))return;
    discard();
    setSelected(next);
  };
  async function save(){
    if(busy||loading)return false;
    if(!dirty)return true;
    setBusy(true);
    setStatus('');
    try{
      const values=Object.fromEntries(fields.map(field=>[
        field.key,field.kind==='secret'?secret:String(current[field.key]||'')
      ]));
      const updated=await authProviderSettingsRequest({type:selected,values});
      if(updated?.type!==selected||updated.active!==false||updated.runtime_connected!==false)
        throw new Error('認證設定未取得安全確認，請核對後再操作。');
      // Confirm persistence through Authority's public metadata endpoint.
      const checked=await authProviderSettingsRequest();
      const persisted=(checked.providers||[]).find(item=>item.type===selected);
      if(!persisted?.configured||fields.some(field=>field.kind!=='secret'&&
        String(persisted[field.key]||'')!==String(updated[field.key]||'')))
        throw new Error('已提交設定，但讀回內容不一致；請重新整理確認。');
      setSaved(previous=>({...previous,[selected]:persisted}));
      setDraft({});
      setSecret('');
      setStatus('設定已儲存並讀回確認；正式登入由 LOC Auth 管理。');
      return true;
    }catch(error){
      setStatus(String(error?.message||'認證設定儲存失敗，登入來源未變更。'));
      return false;
    }finally{setBusy(false)}
  }
  useEditDockForm({save,discard,isDirty:()=>Boolean(dirty),isBusy:()=>busy||loading});

  return <section className="loc-card admin-workspace" aria-labelledby="admin-auth-heading">
    <h2 id="admin-auth-heading">認證來源設定</h2>
    <p className="scope-status">設定不同身分服務的連線參數，驗證後仍由 LOC Authority 管理 Scope 權限。
      選擇來源只是編輯設定，<strong>不會立即切換登入</strong>。</p>
    <p className="scope-status" role="status">
      正式登入：{active==='loc'?'LOC Auth':active}。未完成登入與權限驗證的來源一律不可啟用。
    </p>

    <div className="admin-inline-select">
      <label htmlFor="admin-auth-provider-select">設定認證來源</label>
      <select id="admin-auth-provider-select" className="loc-settings-select"
        disabled={loading||busy} value={selected}
        onChange={event=>selectProvider(event.target.value)}>
        {PROVIDER_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>

    {selected==='loc'?<p className="scope-status">
      LOC Auth 是正式的簽章、Session 與權限委託服務；
      此處只設定外部身分提供者的連線參數，不會洩漏或變更 OAuth 金鑰。
    </p>:<>
      <h3 className="admin-workspace-section-heading">{AUTH_PROVIDER_LABELS[selected]} 連線設定</h3>
      <p className="scope-status">{profile?.configured?'已儲存連線參數':'尚未設定連線參數'}。
        {hasSecret
          ?(profile?.secret_configured?' Secret 已保存；留空可沿用既有 Secret。':' 初次設定需提供 Client Secret。')
          :' 此來源不需要在 LOC 另存 Client Secret。'}
      </p>
      {(selected==='ldap'||selected==='ad')?<p className="scope-status">
        LDAP／AD 使用企業自行管理的 OIDC 橋接服務；不在網站收集 Bind Password 或網域帳密。
      </p>:null}

      <div className="scope-management-fields">
        {fields.map(field=>{
          const longField=field.kind==='url'||field.kind==='secret';
          const id='admin-auth-'+selected+'-'+field.key;
          return <label key={field.key} htmlFor={id}
            className={longField?'scope-management-wide-field':undefined}>
            <span>{field.label}</span>
            <input id={id}
              type={field.kind==='secret'?'password':field.kind==='url'?'url':'text'}
              className="scope-search-input"
              autoComplete={field.kind==='secret'?'new-password':'off'}
              spellCheck={false}
              maxLength={field.kind==='secret'?4096:512}
              value={field.kind==='secret'?secret:String(current[field.key]||'')}
              placeholder={field.kind==='secret'&&profile?.secret_configured?'留空保留既有 Secret':undefined}
              disabled={loading||busy}
              onChange={event=>{
                if(field.kind==='secret')setSecret(event.target.value);
                else setDraft(previous=>({...previous,[field.key]:event.target.value}));
              }}
            />
          </label>;
        })}
      </div>
      <p className="scope-status">Secret 僅經由 LOC Authority 加密保存，重新讀取只顯示是否已設定。
        完成欄位後使用管理頁既有的「儲存」；儲存不代表 OAuth 已接通。</p>
    </>}
    {status?<p role="status" className="scope-status">{status}</p>:null}
    {loading&&!status?<p role="status" className="scope-status">正在讀取認證設定…</p>:null}
  </section>;
}
