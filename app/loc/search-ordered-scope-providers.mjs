// Bounded, ordered cross-Scope search. No result caching, schema changes,
// indexes, RPCs or additional permission bypasses.
//
// The first Scope is queried alone. Only after it misses (or fails), probe the
// next two Scopes with at most TWO concurrent requests. Consume answers in
// original Scope order so stage/offset pagination remains bit-for-bit stable.
// A result from an earlier Scope aborts an unnecessary in-flight lookahead.
function abortError(){
  const error=new Error('Request cancelled');
  error.name='AbortError';
  return error;
}

export async function searchOrderedScopeProviders(providers,query,{
  cursor=null,startDate='',endDate='',and=[],nor=[],limit,
  source='auto',browse=false,signal=null,sortDirection='asc'
}={}){
  const failures=[],pending=new Map();
  let stage=Number.isInteger(cursor?.stage)&&cursor.stage>0?cursor.stage:1;
  let sourceOffset=Math.max(0,Math.floor(Number(cursor?.offset)||0));
  let activeSource=cursor?.source||source;
  let passedFirstMiss=false;

  const launch=(index,offset,providerSource)=>{
    const existing=pending.get(index);
    if(existing)return existing;
    const provider=providers[index-1];
    if(!provider)return null;
    const controller=new AbortController();
    const requestSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    // Always observe failures, including a cancelled speculative request.
    const promise=Promise.resolve().then(()=>{
      if(requestSignal.aborted)throw abortError();
      return provider.search(query,{
        cursor:offset,startDate,endDate,and,nor,limit,
        source:providerSource,browse,signal:requestSignal,sortDirection
      });
    }).then(result=>({result}),error=>({error}));
    const entry={promise,controller};
    pending.set(index,entry);
    return entry;
  };

  try{
    while(stage<=providers.length){
      if(signal?.aborted)throw abortError();
      const provider=providers[stage-1];
      const current=launch(stage,sourceOffset,activeSource);
      if(!provider||!current)break;

      // Search is usually satisfied by the first Scope. Do not send any
      // speculative query until an earlier Scope actually had no results.
      // At most one following Scope may be in flight alongside the current.
      if(passedFirstMiss&&sourceOffset===0&&stage<providers.length&&pending.size<2)
        launch(stage+1,0,'auto');

      const outcome=await current.promise;
      pending.delete(stage);
      if(signal?.aborted)throw abortError();
      if(outcome.error){
        const error=outcome.error;
        if(error?.name==='AbortError')throw error;
        failures.push(new Error(`${provider.id}: ${error?.message||'search failed'}`));
        if(stage===providers.length)
          throw new AggregateError(failures,'資料搜尋 Provider 無法查詢');
      }else{
        const result=outcome.result||{};
        const rows=result.rows||[];
        const hasMore=Boolean(result.hasMore)||stage<providers.length;
        const nextCursor=result.hasMore
          ?{stage,offset:result.nextCursor,source:result.dataSource||activeSource}
          :stage<providers.length?{stage:stage+1,offset:0,source:'auto'}:null;
        if(rows.length||!hasMore)return {rows,failures,hasMore,nextCursor};
      }
      passedFirstMiss=true;
      stage+=1;
      sourceOffset=0;
      activeSource='auto';
    }
    return {rows:[],failures,hasMore:false,nextCursor:null};
  }finally{
    // Abort unused work without caching or exposing a later Scope result.
    for(const entry of pending.values())entry.controller.abort();
    pending.clear();
  }
}
