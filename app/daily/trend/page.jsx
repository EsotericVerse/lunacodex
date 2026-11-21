import LrsWebRedirect from '../../loc/views/LrsWebRedirect';
import {lrsMetadata} from '../../seo/metadata';
export const metadata=lrsMetadata({title:'每日符文趨勢｜LunaRunes',description:'每日符文趨勢由 LunaRunes 提供。',path:'/daily/trend/'});
export default function DailyTrendRedirect(){return <LrsWebRedirect path="/daily/trend/"/>;}
