import RuneUnifiedView from '../../lrunes/RuneUnifiedView';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'符文圖鑑 · 2D／3D｜月之符文',
  description:'九大群組及六十六枚符文圖鑑，2D 卡圖與 3D 特效同頁切換，完整原始符文資料保留。',
  path:'/card/list/'
});
export default function RuneCardList(){return <RuneUnifiedView feature="list" defaultView="3d"/>;}
