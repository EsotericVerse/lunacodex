import LocApp from '../../loc/LocApp';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'每日符文紀錄｜月之符文',
  description:'以行事曆保存每日符文，顯示真實月相邊界、當日指引，以及上一筆相同符文的日期與狀況形容。',
  path:'/daily/log/'
});

export default function Page(){return <LocApp forcedView="home" forcedScope="lrunes"/>;}
