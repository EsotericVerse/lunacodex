import {createNewKeywordDiscovery} from './discovery.mjs';

let discovery=null;
self.onmessage=event=>{
  const {type,rows,existingRows}=event.data||{};
  try{
    if(type==='start'){
      discovery=createNewKeywordDiscovery(existingRows);
      self.postMessage({type:'ready'});
    }else if(type==='batch'){
      if(!discovery)throw new Error('新關鍵詞掃描尚未初始化');
      self.postMessage({type:'progress',...discovery.consume(rows)});
    }else if(type==='finish'){
      if(!discovery)throw new Error('新關鍵詞掃描尚未初始化');
      self.postMessage({type:'finished',result:discovery.finish()});
      discovery=null;
    }
  }catch(error){
    discovery=null;
    self.postMessage({type:'error',error:String(error?.message||error)});
  }
};
