import LocApp from '../loc/LocApp';
import JsonLd from '../seo/JsonLd';
import {lunarunesMetadata,lunarunesWebSiteJsonLd} from '../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'月之符文｜符文籤詩與圖鑑',
  description:'月之符文以固定符文、九組分類、四種方向與月相關係組成，可用於抽籤、籤詩、每日指引與符文圖鑑瀏覽。',
  path:'/'
});

// The /lrunes/ mount belongs to LOC's Scope navigation. Do not redirect
// visitors to the independent LRS project from LOC's header.
export default function LunaRunesScopePage(){
  return <><JsonLd data={lunarunesWebSiteJsonLd()}/><LocApp forcedView="home" forcedScope="lrunes"/></>;
}
