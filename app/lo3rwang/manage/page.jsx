import LocApp from '../../loc/LocApp';
import {authorMetadata} from '../../seo/metadata';
export const metadata=authorMetadata({title:'管理｜政德｜月典',description:'個人資料與作品的管理入口。',path:'/lo3rwang/manage/',noIndex:true});
export default function Page(){return <LocApp forcedView="manage" forcedScope="lo3rwang"/>;}
