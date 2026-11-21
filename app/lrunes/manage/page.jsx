import LocApp from '../../loc/LocApp';
import {lunarunesMetadata} from '../../seo/metadata';
export const metadata=lunarunesMetadata({title:'管理｜月之符文',description:'月之符文資料管理入口。',path:'/manage/',noIndex:true});
export default function Page(){return <LocApp forcedView="manage" forcedScope="lrunes"/>;}
