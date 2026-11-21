import LocApp from '../loc/LocApp';
import {locMetadata} from '../seo/metadata';

// Hidden Scope: never indexed, never linked from navigation (reached only
// via an explicit link from Settings). Private, device-local data only.
export const metadata=locMetadata({
  title:'本機私人匯入',
  description:'裝置本機的私人匯入資料，僅存在這台裝置上。',
  path:'/local/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="home" forcedScope="local"/>;}
