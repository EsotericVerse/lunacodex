import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'痕跡製作｜LOC 月典',
  description:'管理 LOC 的空間定錨點與痕跡圖。',
  path:'/trace/manage/',
  noIndex:true
});

export default function TraceManagementPage(){
  return <LocApp forcedView="manage" forcedScope="loc"/>;
}
