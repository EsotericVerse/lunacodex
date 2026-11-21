import LocApp from '../../loc/LocApp';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'符文與相關文字搜尋｜月之符文',
  description:'從符文名稱、關鍵字與相關文字找到對應內容，並回到完整符文或作品脈絡。',
  path:'/search/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="search" forcedScope="lrunes"/>;}
