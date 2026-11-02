import {Suspense} from 'react';
import FeatureSettingsPage from '../../loc/FeatureSettingsPage';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:"功能設定｜LOC 月典",
  description:'濾鏡、文化、痕跡、統計與搜尋的個人顯示設定。',
  path:"/settings/features/",
  noIndex:true
});

export default function SettingsFeaturesPage(){
  return <Suspense fallback={<p role="status">正在載入功能設定…</p>}>
    <FeatureSettingsPage/>
  </Suspense>;
}
