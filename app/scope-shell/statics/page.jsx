import LocApp from '../../loc/LocApp';
import {loadStatisticsPageInitialData} from '../../loc/statistics/page-bootstrap.mjs';
export const metadata={title:'Scope Statistics｜LOC',robots:{index:false,follow:false}};
export default async function Page({searchParams}){
  const params=await searchParams;
  const scopeId=String(params?.scopeid||'').trim();
  const initialData=scopeId?await loadStatisticsPageInitialData(scopeId):null;
  return <LocApp forcedView="statics" initialData={initialData}/>;
}
