import {timelineVisitWindows,matchTimelineWindows} from './timeline-place-matcher.mjs';

// Timeline archives stay on this browser. Only compact visit/anchor matches
// leave the worker; the full parsed JSON is never retained by the UI thread.
export function analyzeTimelineDocument(document,anchors,{startDate='',endDate=''}={}){
  const visits=timelineVisitWindows(document,{startDate,endDate});
  if(!visits.length)throw Error('這份 JSON 沒有可辨識的造訪地點與時間（行車軌跡不會自動當成打卡）');
  return {visitCount:visits.length,matched:matchTimelineWindows(visits,anchors)};
}

self.onmessage=async event=>{
  try{
    const {file,anchors,startDate,endDate}=event.data||{};
    if(!file||!Array.isArray(anchors))throw Error('缺少 Timeline 檔案或空間定錨點');
    const text=await file.text();
    const result=analyzeTimelineDocument(JSON.parse(text),anchors,{startDate,endDate});
    self.postMessage({ok:true,...result});
  }catch(error){
    self.postMessage({ok:false,error:String(error?.message||error)});
  }
};
