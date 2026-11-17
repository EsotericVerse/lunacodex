'use client';

import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {FeaturePage} from '../../modular/ui';
import {useSearchManagerSwitch} from './use-search-manager-switch';
import {useAccount} from '../auth/use-account';
import useLocUser from './use-loc-user';

// The Settings homepage has one control option. No access lookup, grant
// request, private data read or category/keyword scan runs when toggling it.
export default function FeatureSettingsPage({embedded=false,dashboard=false,accountCard=null}){
  const pathname=usePathname()||'';
  const settingsHref=pathname.startsWith('/local/')?'/local/settings/':'/settings/';
  // Reading this account's OWN preference does not request Scope grants.
  // The switch itself remains a synchronous, permission-free UI control.
  const account=useAccount({enabled:true,sessionOnly:true});
  const preference=useLocUser({verifiedSubject:account.user?.id||''});
  const {enabled,setEnabled}=useSearchManagerSwitch({
    defaultValue:preference.data?.search?.list===true,preferenceReady:preference.ready
  });
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
