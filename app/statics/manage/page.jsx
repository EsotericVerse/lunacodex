import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'關鍵詞管理｜LOC 月典',
  description:'管理 LOC 關鍵詞大群組名稱與 Hash。',
  path:'/statics/manage/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="keywordManage" forcedScope="loc"/>;}
