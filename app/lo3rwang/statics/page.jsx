import LocApp from '../../loc/LocApp';
import {authorMetadata} from '../../seo/metadata';

export const metadata=authorMetadata({
  title:'作品統計與時間變化｜政德｜月典',
  description:'以圖表查看個人作品數量、來源比例與時間變化，並比較不同時期的資料分布。',
  path:'/lo3rwang/statics/'
});

export default function Page(){return <LocApp forcedView="statics" forcedScope="lo3rwang"/>;}
