import LocApp from '../loc/LocApp';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'群組管理｜LOC 月典',
  description:'管理 LOC 群組、人員與作品分類。',
  path:'/manage/',
  noIndex:true
});

export default function Page(){
  return <LocApp forcedView="sourceManage" forcedScope="loc"/>;
}
