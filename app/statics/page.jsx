import LocApp from '../loc/LocApp';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'作品統計與時間變化｜月典',
  description:'以圖表查看作品數量、來源比例與時間變化，並依不同時間範圍比較資料分布。',
  path:'/statics/'
});

export default function StaticsPage(){return <LocApp forcedView="statics"/>;}
