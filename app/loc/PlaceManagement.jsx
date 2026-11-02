'use client';

import dynamic from 'next/dynamic';
import PanelLoading from './PanelLoading';
import TimelinePlaceManager from './TimelinePlaceManager';

const TraceManagement=dynamic(()=>import('./TraceManagement'),{loading:PanelLoading});
const PlaceBatchFill=dynamic(()=>import('./PlaceBatchFill'),{loading:PanelLoading});

// These are first-level Spatial Management tabs, not nested Place Management options.
export const PLACE_OPTIONS=Object.freeze([
  {value:'anchor',label:'空間定錨點',description:'新增或編輯地點、座標、隱藏權限'},
  {value:'names',label:'名稱整理',description:'同位置名稱校正、別名、熱門地點'},
  {value:'timeline',label:'Timeline 地點整理',description:'匯入路線 JSON、審查糾紛點'},
  {value:'quickFill',label:'快速補打卡',description:'原有 location 日期批次補寫'}
]);

export default function PlaceManagement({scopeId,section='anchor'}){
  return <section className="loc-place-workspace" aria-label="空間定錨管理">
    <div className="loc-place-workspace__panel">
      {section==='anchor'?<TraceManagement scopeId={scopeId} mode="anchor"/>:null}
      {section==='names'?<TraceManagement scopeId={scopeId} mode="cleanup"/>:null}
      {section==='timeline'?<TimelinePlaceManager scopeId={scopeId}/>:null}
      {section==='quickFill'?<PlaceBatchFill scopeId={scopeId}/>:null}
    </div>
  </section>;
}
