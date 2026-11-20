import {Suspense} from 'react';
import StaticContentLoading from '../modular/StaticContentLoading';
import GlobalSettings from '../loc/preferences/GlobalSettings';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'設定｜LOC 月典',
  description:'設定首頁、帳號登入、個人功能與每日符文。',
  path:'/settings/',
  noIndex:true
});

export default function SettingsPage(){
  return <Suspense fallback={<StaticContentLoading label="正在載入設定…"/>}>
    <GlobalSettings/>
  </Suspense>;
}
