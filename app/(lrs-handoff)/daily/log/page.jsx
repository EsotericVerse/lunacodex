import LrsWebRedirect from '../../LrsWebRedirect';
import {lrsMetadata} from '../../../seo/metadata';

// Historical daily URLs belong to the independent LRS /daily namespace.
export const metadata=lrsMetadata({
  title:'每日符文紀錄｜LunaRunes',
  description:'每日符文紀錄由 LunaRunes 獨立提供。',
  path:'/daily/log/'
});
export default function DailyLogRedirect(){
  return <LrsWebRedirect path="/daily/log/"/>;
}
