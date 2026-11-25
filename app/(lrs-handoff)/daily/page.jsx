import LrsWebRedirect from '../LrsWebRedirect';
import {lrsMetadata} from '../../seo/metadata';

// LOC owns the Scope; LRS serves /daily and its standalone subroutes.
export const metadata=lrsMetadata({
  title:'每日符文｜LunaRunes',
  description:'LunaRunes 的每日符文功能獨立部署。',
  path:'/daily/'
});
export default function DailyRedirect(){
  return <LrsWebRedirect path="/daily/"/>;
}
