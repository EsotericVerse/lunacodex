import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'搜尋｜本機',
  description:'從本機私人匯入的文章找到對應內容。',
  path:'/local/search/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="search" forcedScope="local"/>;}
