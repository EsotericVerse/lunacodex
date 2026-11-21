import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'統計圖表｜本機',
  description:'查看本機私人匯入資料的數量、來源與時間變化。',
  path:'/local/statics/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="statics" forcedScope="local"/>;}
