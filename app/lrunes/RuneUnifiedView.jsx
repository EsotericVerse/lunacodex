'use client';

import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import './rune-presentation-switch.css';

// Keep the canonical 2D original-art module entirely independent of the
// licensed Effekseer/Three.js renderer. Load only the selected presentation.
const VISUALS=Object.freeze({
  duel:{
    '2d':dynamic(()=>import('./duel2/RuneRitualLab'),{ssr:false}),
    '3d':dynamic(()=>import('./Rune3DPreview'),{ssr:false})
  },
  daily:{
    '2d':dynamic(()=>import('./daily3d/RuneDaily3D'),{ssr:false}),
    '3d':dynamic(()=>import('./Rune3DPreview'),{ssr:false})
  },
  list:{
    '2d':dynamic(()=>import('./list2/RuneAtlasLab'),{ssr:false}),
    '3d':dynamic(()=>import('./Rune3DLibrary'),{ssr:false})
  }
});
const VIEW_LABELS=Object.freeze({'2d':'2D 原創美術','3d':'3D 符文特效'});
const TITLES=Object.freeze({duel:'符文抽牌',daily:'每日符文',list:'符文圖鑑'});

function canonicalView(queryValue,defaultView,allowed){
  return allowed.includes(queryValue)?queryValue:defaultView;
}

export default function RuneUnifiedView({feature='duel',defaultView='3d'}){
  const selectedFeature=Object.hasOwn(VISUALS,feature)?feature:'duel';
  const allowedViews=Object.keys(VISUALS[selectedFeature]);
  const fallback=canonicalView(defaultView,'3d',allowedViews);
  const [view,setView]=useState(fallback);
  useEffect(()=>{
    const read=()=>{
      const params=new URLSearchParams(window.location.search);
      setView(canonicalView(params.get('d'),fallback,allowedViews));
    };
    read();
    window.addEventListener('popstate',read);
    return()=>window.removeEventListener('popstate',read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[fallback,selectedFeature]);

  const selectView=next=>{
    if(!allowedViews.includes(next))return;
    setView(next);
    const url=new URL(window.location.href);
    url.searchParams.set('d',next);
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  };
  const modeControl=<div className="rune-presentation-switch" role="group"
    aria-label={TITLES[selectedFeature]+'的顯示方式'}>
    <span className="rune-presentation-switch-title">{TITLES[selectedFeature]} · 顯示方式</span>
    <div className="rune-presentation-switch-options">
      {allowedViews.map(key=><button key={key} type="button" aria-pressed={view===key}
        className="rune-presentation-switch-option" onClick={()=>selectView(key)}>{VIEW_LABELS[key]}</button>)}
    </div>
  </div>;
  const Component=VISUALS[selectedFeature][view];
  const extraProps=view==='3d'&&selectedFeature!=='list'?{mode:selectedFeature}:{};
  return <Component key={selectedFeature+'-'+view}
    {...extraProps}
    presentationSwitcher={modeControl}/>;
}
