import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';
export const metadata=locMetadata({
  title:'痕跡｜本機',
  description:'查看儲存在這台裝置的本機 Galaxy 地點資料。',
  path:'/local/trace/',
  noIndex:true
});
export default function Page(){return <LocApp forcedView="trace" forcedScope="local"/>;}
