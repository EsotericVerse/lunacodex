import {analyzeRiverDensity} from './river-density-analysis.mjs';

self.onmessage=event=>{
  const {rows=[],lucusDates=[]}=event.data||{};
  try{
    self.postMessage({result:analyzeRiverDensity(rows,lucusDates)});
  }catch(error){
    self.postMessage({error:String(error?.message||error)});
  }
};
