import LocApp from '../loc/LocApp';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'系統管理｜LOC 月典',
  description:'LOC 月典的系統管理入口。',
  path:'/admin/',
  noIndex:true
});

export default function AdminPage(){
  // Admin is a LOC feature, not an independent URL/data Scope.
  return <LocApp forcedView="admin"/>;
}
