// Karaul runs off the React and MapLibre render threads.
import {detectCountChangepoints} from '../../../loc/karaul-count-changepoints.mjs';

self.onmessage=event=>{
  const series=event.data?.values;
  try{
    if(!Array.isArray(series)||series.length<6||series.some(value=>
      !Number.isSafeInteger(value)||value<0))
      return self.postMessage({points:[]});
    const points=detectCountChangepoints(series)
      .filter(index=>Number.isInteger(index)&&index>=2&&index<=series.length-2);
    self.postMessage({points});
  }catch(error){
    // The chart and four descriptive statistics remain usable without PELT.
    self.postMessage({points:[],error:String(error?.message||error)});
  }
};
