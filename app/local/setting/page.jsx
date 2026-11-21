import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'個人設定｜本機',
  description:'本機（僅此裝置）的個人設定。',
  path:'/local/setting/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="setting" forcedScope="local"/>;}
