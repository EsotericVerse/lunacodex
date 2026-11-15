'use client';
import UiText,{useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import globalSettingsZh from '../i18n/sections/uiExtra.globalSettings.zh_tw.js';
registerDefaultSection('uiExtra.globalSettings',globalSettingsZh);

import {useEffect,useMemo,useState} from 'react';
import {useAsyncResource} from '../../packages/zenstack/client-queries';
import dynamic from 'next/dynamic';
import {Capacitor} from '@capacitor/core';
import {useNavigationPreferences} from './use-navigation-preferences';
import {useAccount} from './use-account';
import {FeaturePage} from '../modular/ui';
import ManagementSectionNav,{useManagementSection} from '../modular/ManagementSectionNav';
import PanelLoading from './PanelLoading';
// The home/account Settings screens never download import or management editors.
const PrivateLocalFiles=dynamic(()=>import('./local/PrivateFiles'),{loading:PanelLoading});
const LocalScopeModeSettings=dynamic(()=>import('./local/ModeSettings'),{loading:PanelLoading});
const LocScopeConnections=dynamic(()=>import('./LocScopeConnections'),{loading:PanelLoading});
// 每日符文紀錄：沿用既有的獨立頁面元件（/daily/log/），同一份邏輯透過它自己
// 既有的 embedded 模式嵌入這裡，不複製任何讀寫邏輯。
const DailyRuneCalendarSettings=dynamic(()=>import('../lrunes/DailyRuneCalendarSettings'),{loading:PanelLoading});
import FeatureSettingsPage from './FeatureSettingsPage';
import {selectScopeRegistry} from './scope-data';
import {putSetting} from './user-storage';
import {NavigationPreferences} from '../modular/navigation-preferences';
import {getScope,normalizeScopeId} from '../modular/scope-registry';
const {account:accountNavigation,device:deviceNavigation}=NavigationPreferences;

const option=(value,label,description,shortLabel)=>({value,label,description,shortLabel});
// Always show LOC's existing full-screen login composition, backed by native LOC Auth.
const LOC_LOGIN_GATEWAY='/login/index.html?return_to=';
export default function GlobalSettings({initialSection='features'}={}){
  useUiSection('uiExtra.globalSettings');
  const uiT=useUiText();
  const prefs=useNavigationPreferences();
  const [native,setNative]=useState(false);
  const [urlResolved,setUrlResolved]=useState(false);
  const [home,setHome]=useState('loc');
  const sections=[
    option('features',uiT('uiExtra.globalSettings.featureSettingsHome'),'',uiT('uiExtra.globalSettings.featureSettingsHome')),
    ...(native||prefs.account.user?[option('dailyRune',uiT('uiExtra.globalSettings.dailyRune'),'',uiT('uiExtra.globalSettings.tabDailyRune'))]:[]),
    option('mcp',uiT('uiExtra.globalSettings.mcpSelfServiceTitle'),'',uiT('uiExtra.globalSettings.mcpTab')),
    ...(native?[
      option('local','本機資料庫','','本機'),
      option('manage',uiT('uiExtra.globalSettings.manageMenu'),'',uiT('uiExtra.globalSettings.tabManage'))
    ]:[])
  ];
  // Preserve old deep links without mounting a second settings homepage.
  const [section,setSection]=useManagementSection(sections,initialSection,{favorites:'features',home:'features',account:'features'});

  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [rainbowPreview,setRainbowPreview]=useState(false);
  // LOC Auth owns identity and Scope grants; the trusted application backend checks every signed delegation.
  const verifiedLocAccount=useAccount({enabled:section==='features'||section==='mcp',sessionOnly:true});
  const account=(section==='features'||section==='mcp')?verifiedLocAccount:prefs.account;

  useEffect(()=>{
    const isNative=Capacitor.isNativePlatform();
    setNative(isNative);
    setUrlResolved(true);
  },[]);
  const registryQuery=useAsyncResource(['settings-scope-registry'],selectScopeRegistry,
    {enabled:!native&&urlResolved});
  const registry=registryQuery.data||[];
  useEffect(()=>{
    if(prefs.loading)return;
    setHome(native?deviceNavigation.mobileHomepageChoice(window.localStorage):(accountNavigation.validScopeId(prefs.home)||'loc'));
  },[native,prefs.home,prefs.loading,account.user?.id]);

  const choices=useMemo(()=>{
    const baseChoices=[{id:'lrunes',label:uiT('nav.lunarunes')},{id:'lo3rwang',label:uiT('uiExtra.globalSettings.authorHome')},{id:'loc',label:uiT('uiExtra.globalSettings.locHome')}];
    // Local Scope is not provisioned and must not be offered as an SQL destination.
    const found=new Map(baseChoices.map(item=>[item.id,item]));
    for(const row of registry){
      if(!row?.scope_id||row.scope_id==='admin'||row.scope_id==='local'||getScope(row.scope_id).nativeOnly)continue;
      found.set(row.scope_id,{
        id:row.scope_id,
        label:baseChoices.find(item=>item.id===row.scope_id)?.label||row.display_name||row.scope_id
      });
    }
    return [...found.values()];
  },[registry,native,uiT('common.language')]);
  const allowedHomes=useMemo(()=>{
    // Every public Scope is a valid reading destination, even for Guest.
    const items=choices.filter(item=>item.id!=='admin'&&item.id!=='local');
    if(native)items.push({id:deviceNavigation.MOBILE_HOME_ID,label:uiT('uiExtra.globalSettings.myPhone')});
    return items;
  },[choices,native]);
  const actualHome=native?
    (allowedHomes.some(item=>item.id===home)?home:'loc'):
    accountNavigation.homeScopeForAccount(home,account,allowedHomes.map(item=>item.id));



  const activeSection=section;
  const waiting=Boolean(busy)||prefs.loading||account.loading||account.permissionLoading;
  // Account identity is independent of personal settings and management permission reads.
  const accountWaiting=account.loading;
  // getAccountSession() already rejects unverified Better Auth sessions in
  // loc-browser.mjs. Do not require a second emailVerified field on the
  // client-side identity projection; it is not an additional permission check.
  // Only the canonical owner account may see this cosmetic preview.
  const canPreviewRainbow=activeSection==='features'&&!accountWaiting&&!account.error&&
    Boolean(account.user?.id)&&
    String(account.email||'').trim().toLowerCase()==='sopa2306@gmail.com';
  useEffect(()=>{
    if(canPreviewRainbow)return;
    setRainbowPreview(false);
    window.dispatchEvent(new CustomEvent('loc-owner-rainbow-preview',{detail:{active:false}}));
  },[canPreviewRainbow]);
  useEffect(()=>()=>{
    window.dispatchEvent(new CustomEvent('loc-owner-rainbow-preview',{detail:{active:false}}));
  },[]);
  function toggleRainbowPreview(){
    if(!canPreviewRainbow)return;
    const next=!rainbowPreview;
    setRainbowPreview(next);
    window.dispatchEvent(new CustomEvent('loc-owner-rainbow-preview',{detail:{active:next}}));
  }

  async function saveHome(event){
    event.preventDefault();
    if(waiting||(!native&&!account.user))return;
    setBusy(true);setStatus('');
    try{
      if(native){
        const next=allowedHomes.some(item=>item.id===home)?home:'loc';
        window.localStorage.setItem(deviceNavigation.MOBILE_HOME_STORAGE_KEY,next);
        window.dispatchEvent(new Event('loc-device-navigation-changed'));
        setHome(next);
      }else{
        const next=accountNavigation.homeScopeForAccount(home,account,allowedHomes.map(item=>item.id));
        await putSetting(accountNavigation.HOME_SETTING_KEY,next);
        window.dispatchEvent(new CustomEvent('loc-navigation-changed',{detail:{home:next}}));
        setHome(next);
      }
      setStatus(uiT('uiExtra.globalSettings.savedHome'));
    }catch(error){
      setStatus(uiT('uiExtra.globalSettings.saveFailed',{error:String(error?.message||error)}));
    }finally{setBusy(false);}
  }
  async function logout(){
    setBusy(true);setStatus('');
    try{
      await account.signOut();
      // Signing out is explicit, but never automatically opens the login page.
      setStatus('已登出 LOC Session');
    }catch(error){setStatus(String(error?.message||error));}
    finally{setBusy(false);}
  }
  function login(){
    // Retain the existing LOC login gateway / callback while keeping only a
    // normalized Scope palette hint through the authentication round-trip.
    const sourceScope=normalizeScopeId(new URLSearchParams(window.location.search).get('scopeid'));
    const returnTo='/local/settings/'+(sourceScope?'?scopeid='+encodeURIComponent(sourceScope):'');
    if(!native){window.location.assign(LOC_LOGIN_GATEWAY+encodeURIComponent(returnTo));return;}
    void account.signIn(new URL(returnTo,window.location.href).href)
      .catch(error=>setStatus(String(error?.message||error)));
  }

  const accountCard=<section className="loc-card scope-settings-dashboard__account">
    <h2><UiText id="uiExtra.globalSettings.account"/></h2>
    {accountWaiting?<p role="status">正在核驗 LOC Auth 登入身分…</p>
      :account.user?<p>LOC Auth（已驗證）：{account.email}</p>:null}
    {!accountWaiting&&!account.user?<button type="button" className="loc-button primary"
      disabled={busy} onClick={login}>使用 LOC Auth 登入</button>:null}
    <div className="scope-settings-dashboard__account-actions">
      {account.user?<button type="button" className="loc-button"
        disabled={busy} onClick={logout}><UiText id="uiExtra.globalSettings.logout"/></button>:null}
      {canPreviewRainbow?<button type="button" className="loc-button scope-rainbow-preview-button"
        aria-pressed={rainbowPreview} onClick={toggleRainbowPreview}>
        {rainbowPreview?'關閉彩虹預覽':'預覽彩虹變身'}
      </button>:null}
    </div>
    {canPreviewRainbow&&rainbowPreview?<div className="scope-rainbow-transform-preview" role="img" aria-label="彩虹變身：三層輕量圓環與彩虹流光預覽">
      <span className="scope-rainbow-transform-preview__ring scope-rainbow-transform-preview__ring--outer" aria-hidden="true"/>
      <span className="scope-rainbow-transform-preview__ring scope-rainbow-transform-preview__ring--middle" aria-hidden="true"/>
      <span className="scope-rainbow-transform-preview__ring scope-rainbow-transform-preview__ring--inner" aria-hidden="true"/>
      <span className="scope-rainbow-transform-preview__center" aria-hidden="true">虹</span>
      <span className="scope-rainbow-transform-preview__caption">彩虹變身 · 視覺預覽</span>
    </div>:null}
    {account.error?<div className="scope-status scope-error" role="alert">
      <p>{account.error}</p>
      <button type="button" className="loc-button" disabled={busy||account.loading}
        onClick={()=>void verifiedLocAccount.refresh().catch(error=>setStatus(String(error?.message||error)))}>
        重新確認登入狀態
      </button>
    </div>:null}
    <form onSubmit={saveHome} className="scope-stat-controls scope-settings-dashboard__homepage">
      <label><span><UiText id="uiExtra.globalSettings.defaultHome"/></span>
        <select className="scope-select" value={actualHome}
          onChange={event=>setHome(event.target.value)} disabled={waiting&&!native}>
          {allowedHomes.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {native||account.user?<button type="submit" className="loc-button"
        disabled={waiting}><UiText id="uiExtra.globalSettings.save"/></button>:null}
    </form>
  </section>;

  return <FeaturePage featureId="setting">
    <div className="scope-settings-options management-workspace">
      <ManagementSectionNav id="settings-sections" title={uiT('uiExtra.globalSettings.settingsSections')}
        panelId="settings-management-panel" items={sections} value={activeSection} mobileSelect
        onChange={next=>{setSection(next);setStatus('');}}/>
      <div className="management-workspace-panel" id="settings-management-panel" role="region"
        aria-labelledby={'settings-sections-option-'+activeSection}>
      {activeSection==='features'?<FeatureSettingsPage embedded dashboard accountCard={accountCard}/>:null}
      {activeSection==='mcp'?<LocScopeConnections availableScopes={choices} verifiedAccount={verifiedLocAccount}/>:null}
      {native&&activeSection==='local'?<LocalScopeModeSettings/>:null}

      {activeSection==='dailyRune'?<DailyRuneCalendarSettings/>:null}

      {/* Device management never mounts website Scope/Article/Admin capabilities. */}
      {native&&activeSection==='manage'?<PrivateLocalFiles/>:null}

      {status?<p role="status" className="scope-status">{status}</p>:null}
      </div>
    </div>
  </FeaturePage>;
}
