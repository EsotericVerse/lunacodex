'use client';

import {useEffect,useState} from 'react';

const EMPTY_ANALYSIS=Object.freeze({
  density:[],changepoints:[],hiddenDates:[],suggestions:[],totalCount:0
});

// PELT can be expensive across multi-year daily buckets. Never run it during
// React render or on the browser's main thread.
export function useRiverDensityAnalysis(rows,lucusDates,enabled){
  const [settled,setSettled]=useState(null);
  useEffect(()=>{
    if(!enabled||!rows?.length){
      // A closed suggestion lane must not retain the previous period's daily
      // arrays and worker analysis in React state. Reopening recomputes lazily.
      setSettled(null);
      return undefined;
    }
    let active=true;
    let worker;
    try{
      worker=new Worker(new URL('./river-density-worker.mjs',import.meta.url),{type:'module'});
      worker.onmessage=event=>{
        if(!active)return;
        const {result,error}=event.data||{};
        setSettled({rows,lucusDates,
          analysis:error?{...EMPTY_ANALYSIS,error:'時間密度變化點分析失敗，河道仍可使用。'}:result||EMPTY_ANALYSIS
        });
        worker.terminate();
      };
      worker.onerror=()=>{
        if(active)setSettled({rows,lucusDates,
          analysis:{...EMPTY_ANALYSIS,error:'背景時間密度分析無法啟動，河道仍可使用。'}});
        worker.terminate();
      };
      worker.postMessage({rows,lucusDates});
    }catch{
      if(active)setSettled({rows,lucusDates,
        analysis:{...EMPTY_ANALYSIS,error:'此瀏覽器無法執行背景時間密度分析。'}});
    }
    return ()=>{active=false;worker?.terminate();};
  },[rows,lucusDates,enabled]);

  return enabled&&settled?.rows===rows&&settled?.lucusDates===lucusDates
    ?settled.analysis:EMPTY_ANALYSIS;
}
