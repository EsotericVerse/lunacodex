import LegacyManagementRedirect from '../../loc/management/LegacyManagementRedirect';
import {authorMetadata} from '../../seo/metadata';

export const metadata=authorMetadata({
  title:'空間定錨管理（舊入口）｜政德｜月典',
  description:'空間定錨管理已移至 /lo3rwang/trace/manage/。',
  path:'/lo3rwang/manage/',noIndex:true
});
export default function Page(){
  return <LegacyManagementRedirect target="trace" label="空間定錨管理"/>;
}
