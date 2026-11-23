import LegacyManagementRedirect from '../../loc/management/LegacyManagementRedirect';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'人員作品管理（舊入口）｜LOC 月典',
  description:'人員作品管理已移至 /manage/。',
  path:'/culture/manage/',
  noIndex:true
});
export default function Page(){
  return <LegacyManagementRedirect target="group" label="人員作品管理"/>;
}
