import LocApp from '../../loc/LocApp';
import {authorMetadata} from '../../seo/metadata';

export const metadata=authorMetadata({
  title:'個人作品與文字搜尋｜政德｜月典',
  description:'從關鍵字、作品名稱、來源或日期找到個人文字與作品，再沿關係查看完整內容與前後脈絡。',
  path:'/lo3rwang/search/',
  noIndex:true
});

export default function Page(){return <LocApp forcedView="search" forcedScope="lo3rwang"/>;}
