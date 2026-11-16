import {Suspense} from 'react';
import GlobalSettings from '../../loc/preferences/GlobalSettings';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'設定｜本機',
  description:'設定首頁、帳號登入、個人功能與每日符文。',
  path:'/local/settings/',
  noIndex:true
});

export default function LocalSettingsPage(){
  return <Suspense fallback={<p role="status">正在載入設定…</p>}>
    <GlobalSettings/>
  </Suspense>;
}
