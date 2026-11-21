import LocApp from '../../loc/LocApp';
import {authorMetadata} from '../../seo/metadata';

export const metadata=authorMetadata({
  title:'時間長河與創作軌跡｜政德｜月典',
  description:'把個人作品與紀錄放回時間順序，透過時間長河、定錨點與來源分布回看不同時期的創作軌跡。',
  path:'/lo3rwang/culture/'
});

export default function Page(){return <LocApp forcedView="culture" forcedScope="lo3rwang"/>;}
