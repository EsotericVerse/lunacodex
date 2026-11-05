// Opt-in ChatGPT web capture. Only new, visible, sent user messages.
// Timestamp = first observed in this tab, not the platform's historical send time.
(()=>{
  if(globalThis.__locGalaxyCaptureInstalled)return;
  globalThis.__locGalaxyCaptureInstalled=true;
  const CHAT=/^\/((g\/[^/]+\/)?c\/)([a-zA-Z0-9-]{8,})/;
  let stopped=false,observed=new Set(),conversation='',observer=null;
  function current(){
    if(location.origin!=='https://chatgpt.com')return null;
    const match=location.pathname.match(CHAT);
    return match?'chatgpt:'+match[3]:null;
  }
  function scan(){
    if(stopped)return;
    const id=current();
    if(!id){conversation='';observed=new Set();return;}
    if(id!==conversation){
      conversation=id;
      observed=new Set();
      // Baseline: never pretend old DOM messages have trustworthy send timestamps.
      for(const el of document.querySelectorAll('[data-message-id]')){
        const mid=el.getAttribute('data-message-id');
        if(mid)observed.add(mid);
      }
      return;
    }
    for(const el of document.querySelectorAll('[data-message-id]')){
      const mid=el.getAttribute('data-message-id');
      if(!mid||observed.has(mid))continue;
      const role=el.getAttribute('data-message-author-role')||
        el.closest('[data-message-author-role]')?.getAttribute('data-message-author-role');
      // Only user-authored sent messages; assistant output requires explicit selection.
      if(role!=='user')continue;
      const text=(el.querySelector('.whitespace-pre-wrap')||el).innerText?.trim()||'';
      if(!text||text.length>20000)continue;
      observed.add(mid);
      chrome.runtime.sendMessage({
        type:'locGalaxy.captureObserved',
        conversation_id:id,message_id:mid,text,
        observed_at:new Date().toISOString()
      }).catch(()=>{ /* The background's pending queue is authoritative, not this page. */ });
    }
  }
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.type==='locGalaxy.captureStop'){
      stopped=true;observer?.disconnect();
      globalThis.__locGalaxyCaptureInstalled=false;
    }
  });
  scan();
  observer=new MutationObserver(()=>scan());
  observer.observe(document.documentElement,{subtree:true,childList:true});
  // SPA history transitions may not mutate an observed message subtree immediately.
  document.addEventListener('visibilitychange',scan);
})();
