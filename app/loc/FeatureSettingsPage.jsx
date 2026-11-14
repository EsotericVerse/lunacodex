'use client';
import {useMemo,useState} from 'react';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {FeaturePage} from '../modular/ui';
import ManagementSectionNav from '../modular/ManagementSectionNav';
import {useUiSection} from '../i18n/ui-locale';
import {useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import globalSettingsZh from '../i18n/sections/uiExtra.globalSettings.zh_tw.js';
import {useAccount} from './use-account';
import useDefaultTimeUnit from './use-default-time-unit';
import {saveDefaultTimeUnit,DEFAULT_TIME_UNITS} from './default-time-unit.mjs';
registerDefaultSection('uiExtra.globalSettings',globalSettingsZh);

import LocUserSettingsPanel from './LocUserSettingsPanel';
const KEY='uiExtra.globalSettings.';

export default function FeatureSettingsPage({embedded=false}){
  useUiSection('uiExtra.globalSettings');
  const t=useUiText();
  const pathname=usePathname()||'';
  const settingsHref=pathname.startsWith('/local/')?'/local/settings/':'/settings/';
  const account=useAccount({enabled:true,sessionOnly:true});
  const [loginError,setLoginError]=useState('');
  const [timeError,setTimeError]=useState(false);
  const timeUnit=useDefaultTimeUnit();
  const sections=useMemo(()=>[
    {value:'filter',label:t(KEY+'featureFilter')},
    {value:'cultureTrace',label:t(KEY+'featureCultureTrace')},
    {value:'staticsSearch',label:t(KEY+'featureStaticsSearch')}
  ],[t(KEY+'featureFilter'),t(KEY+'featureCultureTrace'),t(KEY+'featureStaticsSearch')]);
  // React-only category selection: never push a route or rewrite the parent Settings URL.
  const [section,setSection]=useState('filter');
  const login=()=>{
    setLoginError('');
    void account.signIn(new URL(window.location.href).href)
      .catch(error=>setLoginError(String(error?.message||error)));
  };

  const content=<div className="scope-settings-options management-workspace">
      {/* The parent Settings / Feature Hero already names this page.
          Keep the standalone back link, not a second title card. */}
      {!embedded?<nav aria-label={t(KEY+'featureSettings')}>
        <Link href={settingsHref} className="loc-button">{t(KEY+'featureSettingsBack')}</Link>
      </nav>:null}
      <ManagementSectionNav id="feature-settings-sections"
        title={t(KEY+'featureSettingsSections')}
        panelId="feature-settings-panel"
        items={sections} value={section} onChange={setSection}/>
      <div id="feature-settings-panel" className="management-workspace-panel"
        role="region" aria-labelledby={'feature-settings-sections-option-'+section}>
        {section==='filter'?<section className="loc-card">
          <h2>{t(KEY+'timeFilterTitle')}</h2>
          <label className="scope-stat-controls">
            <span>{t(KEY+'timeFilterLabel')}</span>
            <select className="scope-select" value={timeUnit} onChange={event=>{
              setTimeError(!saveDefaultTimeUnit(event.target.value));
            }}>
              {DEFAULT_TIME_UNITS.map(unit=><option value={unit} key={unit}>
                {t(KEY+'timeUnit'+unit[0].toUpperCase()+unit.slice(1))}
              </option>)}
            </select>
          </label>
          <p className="scope-status">{t(KEY+'timeFilterHint')}</p>
          {timeError?<p role="alert" className="scope-status scope-error">{t(KEY+'timeFilterSaveFailed')}</p>:null}
        </section>:null}
        {account.user?<LocUserSettingsPanel verifiedSubject={account.user.id} section={section}/>
          :<section className="loc-card">
            <h2>{t(KEY+'featureSettingsSignIn')}</h2>
            <p className="scope-status">{t(KEY+'featureSettingsSignInHint')}</p>
            {account.loading?<p className="scope-status" role="status">{t(KEY+'featureLoading')}</p>:null}
            <button type="button" className="loc-button primary" onClick={login}>{t(KEY+'login')}</button>
            {account.error||loginError?<p role="alert" className="scope-status scope-error">{loginError||account.error}</p>:null}
          </section>}
      </div>
    </div>;
  return embedded?content:<FeaturePage featureId="setting">{content}</FeaturePage>;
}
