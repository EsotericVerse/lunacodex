import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'時間定錨管理｜LOC 月典',
  description:'管理 LOC 時間定錨。',
  path:'/culture/manage/',
  noIndex:true
});
export default function Page(){
  return <LocApp forcedView="culture" forcedSection="timeManage" forcedScope="loc"/>;
}
