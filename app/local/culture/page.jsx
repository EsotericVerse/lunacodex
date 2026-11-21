import LocApp from '../../loc/LocApp';
import {locMetadata} from '../../seo/metadata';

export const metadata=locMetadata({
  title:'文化時間長河｜本機',
  description:'把本機私人匯入的紀錄放回時間順序，觀察不同時期的變化。',
  path:'/local/culture/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="culture" forcedScope="local"/>;}
