'use client';
import {useEffect,useState} from 'react';
import UiText from '../../../i18n/UiText';
import FieldText from '../../../i18n/FieldText';
import {registerDefaultSection} from '../../../i18n/ui-copy';
import {useUiSection} from '../../../i18n/ui-locale';
import adminViewZh from '../../../i18n/sections/uiExtra.adminView.zh_tw.js';
import {THEME_SLOTS,THEME_TOKEN_KEYS} from '../../../modular/theme-registry';
import {mergeThemeSlot,THEME_DB_COLUMNS,themeColumnForToken,themeUiId,themeNumber,normalizeThemeHex,deriveThemeTokens} from '../../theme-data';
import {dbAuthRelation,dbAuthClient} from '../../db-client.mjs';
import {useEditDockForm} from '../../../modular/edit-dock';
registerDefaultSection('uiExtra.adminView',adminViewZh);

export default function ThemeEditor(){
  useUiSection('uiExtra.adminView');
  const [rows,setRows]=useState([]);
  const [themeId,setThemeId]=useState(()=>{
    const current=typeof document==='undefined'?'':String(document.documentElement.dataset.themeId||'');
    return THEME_SLOTS.some(item=>item.id===current)?current:'theme-7';
  });
  // The published catalog is the safe read-only display fallback.
  // Never leave the editor blank while a remote Theme read is pending.
  const [draft,setDraft]=useState(()=>mergeThemeSlot(themeId,null));
  const [status,setStatus]=useState('');
  const [readState,setReadState]=useState('loading');

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const {data,error}=await dbAuthRelation('silver.loc').select('theme').eq('id','loc').single();
        if(!active)return;
        if(error)throw error;
        setRows((Array.isArray(data?.theme)?data.theme:[]).map(row=>({
          ...row,
          theme_id:themeUiId(row.theme_id),
          theme_db_numeric:typeof row.theme_id==='number'
        })));
        setReadState('ready');
      }catch(error){
        if(!active)return;
        setReadState('error');
        setStatus('主題資料庫讀取失敗；目前顯示已發布配色，禁止覆寫：'+
          String(error?.message||error));
      }
    })();
    return()=>{active=false};
  },[]);

  useEffect(()=>{
    const override=rows.find(row=>row.theme_id===themeId)||null;
    setDraft(mergeThemeSlot(themeId,override));
  },[themeId,rows]);

  const options=(rows.length?rows:THEME_SLOTS).map(theme=>({
    value:theme.theme_id||theme.id,
    label:theme.theme_name||theme.label||THEME_SLOTS.find(slot=>slot.id===(theme.theme_id||theme.id))?.label||theme.theme_id||theme.id
  }));
  function setIdentityColor(value){
    const normalized=normalizeThemeHex(value);
    setDraft(current=>{
      if(!current)return current;
      if(!normalized)return {...current,identityColor:value};
      const generated=deriveThemeTokens(normalized,current.scheme,current.tokens)||{};
      return {...current,identityColor:normalized,tokens:{...current.tokens,...generated}};
    });
  }
  function setScheme(value){
    setDraft(current=>{
      if(!current)return current;
      const scheme=value==='dark'?'dark':'light';
      const generated=deriveThemeTokens(current.identityColor,scheme,current.tokens)||{};
      return {...current,scheme,tokens:{...current.tokens,...generated}};
    });
  }
  function setToken(key,value){
    const normalized=key==='--loc-accent'?normalizeThemeHex(value):'';
    if(normalized){
      setDraft(current=>{
        if(!current)return current;
        const generated=deriveThemeTokens(normalized,current.scheme,current.tokens)||{};
        return {...current,identityColor:normalized,tokens:{...current.tokens,...generated,'--loc-accent':normalized}};
      });
      return;
    }
    setDraft(current=>({...current,tokens:{...current.tokens,[key]:value}}));
  }

  async function save(){
    if(!draft)return false;
    if(readState!=='ready'){
      setStatus('主題資料庫尚未成功讀取，為避免覆寫既有設定，已停止儲存。');
      return false;
    }
    if(!normalizeThemeHex(draft.identityColor)){setStatus('主色請使用 #RRGGBB 格式。');return false;}
    setStatus('');
    try{
      const existing=rows.find(row=>row.theme_id===themeId)||null;
      const payload={
        theme_id:themeNumber(themeId),
        theme_name:String(draft.label||themeId).trim(),
        theme_order:Number(existing?.theme_order)||Number(String(themeId).split('-')[1])||1,
        scheme:draft.scheme==='dark'?'dark':'light',
        style_key:String(draft.styleKey||''),
        identity_color:normalizeThemeHex(draft.identityColor),
        ...Object.fromEntries(THEME_TOKEN_KEYS.map(key=>[
          themeColumnForToken(key),String(draft.tokens?.[key]||'').trim()
        ]))
      };
      const {error}=await dbAuthClient.schema('silver').managedAction('loc_admin_settings',{
        p_section:'theme',p_operation:'upsert',p_key:String(themeNumber(themeId)),p_value:payload
      });
      if(error)throw new Error(error.message||'Theme 儲存失敗。');
      // Keep the just-saved Admin draft available without fetching LOC
      // again. Public Theme JSON/CSS is refreshed only by sync:public.
      setRows(current=>current.map(row=>row.theme_id===themeId
        ?{...payload,theme_id:themeId,theme_db_numeric:existing?.theme_db_numeric===true}
        :row));
      setStatus((draft.label||'主題')+' 已儲存。公開主題於下次 sync:public 發布後更新。');
      return true;
    }catch(error){setStatus(error?.message||'Theme 儲存失敗。');return false;}
  }
  const baseline=mergeThemeSlot(themeId,rows.find(row=>row.theme_id===themeId)||null);
  useEditDockForm({
    save,
    isDirty:()=>Boolean(draft&&JSON.stringify(draft)!==JSON.stringify(baseline)),
    discard:()=>setDraft(baseline)
  });

  return <section className="loc-card admin-workspace">
    <h2><UiText id="uiExtra.adminView.themeAppearance"/></h2>
    {readState==='loading'?<p className="scope-status" role="status">正在讀取主題資料庫設定…</p>:null}
    <div className="admin-inline-select">
      <label htmlFor="admin-theme-select"><UiText id="uiExtra.adminView.editingTheme"/></label>
      <select id="admin-theme-select" className="loc-settings-select" value={themeId}
        onChange={event=>{
          const next=event.target.value;
          if(!next||next===themeId)return;
          if(draft&&JSON.stringify(draft)!==JSON.stringify(baseline)&&
             !window.confirm('目前的主題草稿尚未儲存，確定放棄再切換？'))return;
          setThemeId(next);
        }}>
        {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
    {draft?<>
      <div className="scope-management-fields">
        <label><span><UiText id="uiExtra.adminView.name"/></span><input value={draft.label||''} onChange={e=>setDraft(v=>({...v,label:e.target.value}))}/></label>
        <label><span><UiText id="uiExtra.adminView.themeScheme"/></span><select className="admin-native-select" value={draft.scheme||'light'} onChange={e=>setScheme(e.target.value)}><option value="light"><UiText id="uiExtra.adminView.lightScheme"/></option><option value="dark"><UiText id="uiExtra.adminView.darkScheme"/></option></select></label>
        <label><span><UiText id="uiExtra.adminView.themeGroup"/></span><input value={draft.label||''} disabled title="Group 使用主題名稱，不重複儲存"/></label>
        <label><span><UiText id="uiExtra.adminView.themeStyleKey"/></span><input value={draft.styleKey||''} onChange={e=>setDraft(v=>({...v,styleKey:e.target.value}))}/></label>
        <fieldset className="admin-theme-primary-color">
          <legend><UiText id="uiExtra.adminView.themePrimaryColor"/></legend>
          <div className="admin-theme-primary-color-fields">
            <label><span><UiText id="uiExtra.adminView.themeColorPicker"/></span><input type="color" aria-label="選擇主色" value={normalizeThemeHex(draft.identityColor)||normalizeThemeHex(draft.tokens?.['--loc-accent'])||'#555555'} onChange={e=>setIdentityColor(e.target.value)}/></label>
            <label><span><UiText id="uiExtra.adminView.themeHexCode"/></span><input aria-label="主色色碼" value={draft.identityColor||''} maxLength={7} placeholder="#RRGGBB" onChange={e=>setIdentityColor(e.target.value)}/></label>
          </div>
          <small><UiText id="uiExtra.adminView.themePrimaryHelp"/></small>
        </fieldset>
      </div>
      <section className="scope-inline-card admin-theme-local-preview" aria-label="主題色彩預覽" style={{...draft.tokens,background:'var(--loc-bg)',color:'var(--loc-text)',borderColor:'var(--loc-line)'}}>
        <strong style={{color:'var(--loc-heading)'}}>色彩預覽：{draft.label||themeId}</strong>
        <p style={{color:'var(--loc-muted)'}}>預覽整套主題草稿；這裡的變更尚未套用到網站。</p>
        <div className="admin-theme-preview-sample" style={{background:'var(--loc-panel)',border:'1px solid var(--loc-line)'}}>
          <strong style={{color:'var(--loc-accent)'}}>強調色文字</strong>
          <span style={{color:draft.identityColor||'var(--loc-accent)'}}>主色基準</span>
          <span style={{color:'var(--loc-gold)'}}>輔助色文字</span>
          <button type="button" style={{background:'linear-gradient(135deg,var(--loc-primary-start),var(--loc-primary-end))',color:'var(--loc-text)',borderColor:'var(--loc-accent-border)'}}>主要按鈕</button>
          <span style={{color:'var(--loc-danger)'}}>錯誤提示色</span>
        </div>
      </section>
      <details className="admin-theme-advanced-colors">
        <summary><UiText id="uiExtra.adminView.advancedThemeColors"/></summary>
        <p><UiText id="uiExtra.adminView.advancedThemeColorsHelp"/></p>
        <div className="admin-theme-token-grid">
        {THEME_TOKEN_KEYS.map(key=>{
          const value=String(draft.tokens?.[key]||'');
          const color=/^#[0-9a-f]{6}$/i.test(value);
          return <label key={key}><span>{key}</span><div className="admin-theme-token-input">{color?<input type="color" value={value} onChange={e=>setToken(key,e.target.value)}/>:null}<input value={value} onChange={e=>setToken(key,e.target.value)}/></div></label>;
        })}
        </div>
      </details>
      <p className="scope-status">修改後請使用六大功能列的「儲存」。</p>
    </>:null}
    {status?<p className="scope-status" role="status">{status}</p>:null}
  </section>;
}
