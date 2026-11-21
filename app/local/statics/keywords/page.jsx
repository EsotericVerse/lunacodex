import LocApp from '../../../loc/LocApp';
import {locMetadata} from '../../../seo/metadata';

export const metadata=locMetadata({
  title:'關鍵詞設定｜本機',
  description:'管理本機私人 Scope 的關鍵詞 Class、Group、Item 與分析設定。',
  path:'/local/statics/keywords/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="keywords" forcedScope="local"/>;}
