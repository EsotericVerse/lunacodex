import {Suspense} from 'react';
import FeatureSettingsPage from '../../../loc/preferences/FeatureSettingsPage';
import {locMetadata} from '../../../seo/metadata';

export const metadata=locMetadata({
  title:"功能設定｜本機",
  description:'LOC 使用者登入與搜尋管理者開關設定。',
  path:"/local/settings/features/",
  noIndex:true
});

export default function SettingsFeaturesPage(){
  return <Suspense fallback={<p role="status">正在載入功能設定…</p>}>
    <FeatureSettingsPage/>
  </Suspense>;
}
