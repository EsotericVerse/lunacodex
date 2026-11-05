'use client';
import UiText,{useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import globalSettingsZh from '../i18n/sections/uiExtra.globalSettings.zh_tw.js';
registerDefaultSection('uiExtra.globalSettings',globalSettingsZh);

import {useEffect,useMemo,useState} from 'react';
import {useAsyncResource} from './use-async-resource';
import dynamic from 'next/dynamic';
import {Capacitor} from '@capacitor/core';
import {useNavigationPreferences} from './use-navigation-preferences';
import {useAccount} from './use-account';
import {FeaturePage} from '../modular/ui';
import ManagementSectionNav,{useManagementSection} from '../modular/ManagementSectionNav';
import PanelLoading from './PanelLoading';
import {recoverChunkOnce} from './chunk-recovery.mjs';
// The home/account Settings screens never download import or management editors.
const PrivateLocalFiles=dynamic(()=>import('./PrivateLocalFiles'),{loading:PanelLoading});
const ClerkScopeConnections=dynamic(()=>import('./ClerkScopeConnections'),{loading:PanelLoading});
const LocalDatabaseImport=dynamic(()=>import('./LocalDatabaseImport'),{loading:PanelLoading});
// 每日符文紀錄：沿用既有的獨立頁面元件（/daily/log/），同一份邏輯透過它自己
// 既有的 embedded 模式嵌入這裡，不複製任何讀寫邏輯。
const DailyRuneCalendarSettings=dynamic(()=>import('../lrunes/DailyRuneCalendarSettings'),{loading:PanelLoading});
import FeatureSettingsPage from './FeatureSettingsPage';
import {selectScopeRegistry} from './scope-data';
import {putSetting} from './user-storage';
import {NavigationPreferences} from '../modular/navigation-preferences';
import {getScope} from '../modular/scope-registry';
const {account:accountNavigation,device:deviceNavigation}=NavigationPreferences;

const option=(value,label,description,shortLabel)=>({value,label,description,shortLabel});
// Always show LOC's full-screen Clerk gateway, not a provider-specific login UI.
const LOC_LOGIN_GATEWAY='/login/index.html?return_to=%2Flocal%2Fsettings%2F';
export default function GlobalSettings({initialSection='home'}={}){
  useUiSection('uiExtra.globalSettings');
  const uiT=useUiText();
  const prefs=useNavigationPreferences();
  const [native,setNative]=useState(false);
  const [urlResolved,setUrlResolved]=useState(false);
  const [home,setHome]=useState('loc');
  const sections=[
    option('home',uiT('uiExtra.globalSettings.homeSettings'),uiT('uiExtra.globalSettings.homeSettingsDescription'),uiT('uiExtra.globalSettings.tabHome')),
    option('features',uiT('uiExtra.globalSettings.featureSettings'),uiT('uiExtra.globalSettings.featureSettingsDescription'),uiT('uiExtra.globalSettings.featureSettingsShort')),
    option('mcp',uiT('uiExtra.globalSettings.mcpSelfServiceTitle'),uiT('uiExtra.globalSettings.mcpSelfServiceIntro'),uiT('uiExtra.globalSettings.mcpTab')),
    ...(native?[option('manage',uiT('uiExtra.globalSettings.manageMenu'),uiT('uiExtra.globalSettings.manageMenuDescription'),uiT('uiExtra.globalSettings.tabManage'))]:[]),
    ...(native||prefs.account.user?[option('dailyRune',uiT('uiExtra.globalSettings.dailyRune'),uiT('uiExtra.globalSettings.dailyRuneDescription'),uiT('uiExtra.globalSettings.tabDailyRune'))]:[]),
    ...(native&&Capacitor.getPlatform()==='ios'?[option('files',uiT('uiExtra.globalSettings.documentImport'),uiT('uiExtra.globalSettings.documentImportDescription'),uiT('uiExtra.globalSettings.tabDocumentImport'))]:[])
  ];
  // favorites is the legacy URL alias for the public home/settings panel.
  const [section,setSection]=useManagementSection(sections,initialSection,{favorites:'home',account:'home'});

  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  // Clerk exclusively handles login; management permissions are still checked by SQL.
  const verifiedGoogleAccount=useAccount({enabled:section==='home',sessionOnly:true});
  const account=section==='home'?verifiedGoogleAccount:prefs.account;

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
    // A Web visitor must not reach the device-only SQLite Scope from Settings.
    if(native)baseChoices.push({id:'local',label:uiT('uiExtra.globalSettings.localScope')});
    const found=new Map(baseChoices.map(item=>[item.id,item]));
    for(const row of registry){
      if(!row?.scope_id||row.scope_id==='admin'||(!native&&getScope(row.scope_id).nativeOnly))continue;
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

  const favoriteItems=useMemo(()=>{
    const ids=native?
      ['lrunes',...(deviceNavigation.mobileFavoriteEnabled(typeof window==='undefined'?null:window.localStorage)?[deviceNavigation.MOBILE_HOME_ID]:[]),...prefs.favorites]:
      prefs.favorites;
    const unique=[...new Set(ids)];
    return unique.map(id=>id===deviceNavigation.MOBILE_HOME_ID?{id,label:uiT('uiExtra.globalSettings.myPhone')}:choices.find(item=>item.id===id))
      .filter(Boolean);
  },[native,prefs.favorites.join(','),choices]);

  const activeSection=section;
  const waiting=Boolean(busy)||prefs.loading||account.loading||account.permissionLoading;
  // Account identity is independent of personal settings and management permission reads.
  const accountWaiting=account.loading;

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
      if(native)window.location.reload();
      else window.location.assign(LOC_LOGIN_GATEWAY);
    }catch(error){setStatus(String(error?.message||error));setBusy(false);}
  }
  function login(){
    if(!native){window.location.assign(LOC_LOGIN_GATEWAY);return;}
    void account.signIn(new URL('/local/settings/',window.location.href).href)
      .catch(error=>setStatus(String(error?.message||error)));
  }

  return <FeaturePage featureId="setting">
    <div className="scope-settings-options management-workspace">
      <ManagementSectionNav id="settings-sections" title={uiT('uiExtra.globalSettings.settingsSections')}
        panelId="settings-management-panel" items={sections} value={activeSection}
        onChange={next=>{setSection(next);setStatus('');}}/>
      <div className="management-workspace-panel" id="settings-management-panel" role="region"
        aria-labelledby={'settings-sections-option-'+activeSection}>
      {activeSection==='home'?<div className="loc-settings-panel-group">
        <section className="loc-card">
          <h2><UiText id="uiExtra.globalSettings.account"/></h2>
          {accountWaiting?<p role="status">正在核驗 Clerk 登入身分…</p>:account.user?<p>Clerk Google（已驗證）：{account.email}</p>:null}
          {!accountWaiting&&!account.user?<button type="button" className="loc-button primary" disabled={busy} onClick={login}>使用 Clerk Google 登入</button>:null}
          {account.user||prefs.account.user?<button type="button" className="loc-button" disabled={busy} onClick={logout}><UiText id="uiExtra.globalSettings.logout"/></button>:null}
          {account.error?<div className="scope-status scope-error" role="alert">
            <p>{account.error}</p>
            <button type="button" className="loc-button" disabled={busy||account.loading}
              onClick={()=>void verifiedGoogleAccount.refresh().catch(error=>setStatus(String(error?.message||error)))}>
              重新確認登入狀態
            </button>
          </div>:null}
        </section>
        <section className="loc-card">
        <h2><UiText id="uiExtra.globalSettings.homeSettings"/></h2>
        <form onSubmit={saveHome} className="scope-stat-controls">
          <label><span><UiText id="uiExtra.globalSettings.defaultHome"/></span>
            <select className="scope-select" value={actualHome} onChange={event=>setHome(event.target.value)}
              disabled={waiting&&!native}>
              {allowedHomes.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {native||account.user?<button type="submit" className="loc-button primary" disabled={waiting}><UiText id="uiExtra.globalSettings.save"/></button>:null}
        </form>
        <div className="scope-settings-favorite-preview">
          <strong><UiText id="uiExtra.globalSettings.favorites"/></strong>
          <div className="scope-settings-favorite-items">
            {favoriteItems.map(item=><span key={item.id} className="scope-settings-favorite-item">{item.label}</span>)}
          </div>
        </div>
      </section>
      </div>:null}

      {activeSection==='features'?<FeatureSettingsPage embedded/>:null}
      {activeSection==='mcp'?<ClerkScopeConnections availableScopes={choices}/>:null}

      {/* iOS-only document import; cloud Scope imports remain in Scope management. */}
      {native&&Capacitor.getPlatform()==='ios'&&activeSection==='files'?<LocalDatabaseImport/>:null}
      {activeSection==='dailyRune'?<DailyRuneCalendarSettings/>:null}

      {/* Device management never mounts website Scope/Article/Admin capabilities. */}
      {native&&activeSection==='manage'?<PrivateLocalFiles/>:null}

      {status?<p role="status" className="scope-status">{status}</p>:null}
      </div>
    </div>
  </FeaturePage>;
}
