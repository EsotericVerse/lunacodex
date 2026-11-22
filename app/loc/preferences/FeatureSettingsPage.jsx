'use client';

import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {FeaturePage} from '../../modular/ui';
import {useSearchManagerSwitch} from './use-search-manager-switch';

// The Settings homepage has one control option. No access lookup, grant
// request, private data read or category/keyword scan runs when toggling it.
export default function FeatureSettingsPage({embedded=false,dashboard=false,accountCard=null}){
  const pathname=usePathname()||'';
  const settingsHref=pathname.startsWith('/local/')?'/local/settings/':'/settings/';
  // The cosmetic switch is session-local and defaults off. Entering Settings
  // must not query personal preference SQL just to render this toggle; authorization
  // still occurs only when a protected editor is actually entered.
  const {enabled,setEnabled}=useSearchManagerSwitch();
  const controls=<section className="loc-card scope-settings-dashboard__filter" aria-label="控制選項">
    <h2>控制選項</h2>
    <label className="scope-search-admin-switch">
      <input type="checkbox" role="switch" checked={enabled}
        onChange={event=>setEnabled(event.target.checked)}/>
      管理者
    </label>
  </section>;
  if(dashboard)return <div className="scope-settings-dashboard" role="group" aria-label="設定首頁">
    {accountCard}
    {controls}
  </div>;
  const content=<>
    {!embedded?<nav aria-label="返回設定">
      <Link href={settingsHref} className="loc-button">返回設定</Link>
    </nav>:null}
    {controls}
  </>;
  return embedded?content:<FeaturePage featureId="setting">{content}</FeaturePage>;
}
