import {Suspense} from 'react';
import StaticContentLoading from '../../modular/StaticContentLoading';
import FeatureSettingsPage from '../../loc/preferences/FeatureSettingsPage';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:"功能設定｜LOC 月典",
  description:'LOC 使用者登入與搜尋管理者開關設定。',
  path:"/settings/features/",
  noIndex:true
});

export default function SettingsFeaturesPage(){
  return <Suspense fallback={<StaticContentLoading label="正在載入功能設定…"/>}>
    <FeatureSettingsPage/>
  </Suspense>;
}
