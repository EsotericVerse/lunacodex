// LOC Web redirects to sole LRS implementation; LOC iOS overlays original LRS page.
import LrsWebRedirect from '../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'月之符文｜符文籤詩與圖鑑',
  description:'月之符文以固定符文、九組分類、四種方向與月相關係組成，可用於抽籤、籤詩、每日指引與符文圖鑑瀏覽。',
  path:'/'
});
export default function LrsWebRoute(){return <LrsWebRedirect path="/"/>;}
