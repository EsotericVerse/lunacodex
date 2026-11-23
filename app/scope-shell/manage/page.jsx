import LegacyManagementRedirect from '../../loc/management/LegacyManagementRedirect';
export const metadata={title:'Scope 管理舊入口｜LOC',robots:{index:false,follow:false}};
export default function Page(){
  return <LegacyManagementRedirect target="trace" label="空間定錨管理"/>;
}
