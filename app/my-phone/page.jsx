import LocalScopeWorkspace from '../loc/local/Workspace';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'我的手機｜LOC',
  description:'僅供 iOS LOC App 存取的個人 Local File 首頁。',
  path:'/my-phone/',
  noIndex:true
});

export default function MyPhonePage(){return <LocalScopeWorkspace view="home"/>;}
