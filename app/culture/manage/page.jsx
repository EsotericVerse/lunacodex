import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'人員作品管理｜LOC 月典',
  description:'管理 LOC 群組既有人員顯示名稱與作品群組分類；系統 Email、保留 ID 與資料庫設定另屬系統管理。',
  path:'/culture/manage/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="sourceManage" forcedScope="loc"/>;}
