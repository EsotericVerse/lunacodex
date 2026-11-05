// Runs only after an explicit toolbar action on the active ChatGPT tab.
// No private API calls. Extracts rendered text as presented by the website.
export async function extractOpenConversation(){
  const id=/^\/(?:g\/[^/]+\/)?c\/([a-zA-Z0-9-]{8,})/.exec(location.pathname)?.[1];
  if(location.origin!=='https://chatgpt.com'||!id)
    throw Error('請先開啟 chatgpt.com 的單一對話頁面');
  const found=new Map();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function collect(){
    for(const node of document.querySelectorAll('[data-message-id]')){
      const message_id=node.getAttribute('data-message-id');
      const role=node.getAttribute('data-message-author-role')||
        node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
      if(!message_id||!['user','assistant'].includes(role)||found.has(message_id))continue;
      // Prefer the rendered message body, not the surrounding navigation/actions.
      const content=node.querySelector('[data-message-author-role] .markdown')||
        node.querySelector('.markdown')||
        node.querySelector('.whitespace-pre-wrap')||
        node.querySelector('[data-message-author-role]')||node;
      const text=content.innerText?.trim()||'';
      if(!text||text.length>80000)continue;
      found.set(message_id,{message_id,role,kind:role==='user'?'original':'advice',text});
    }
  }
  collect();
  const first=document.querySelector('[data-message-id]');
  let scroll=first?.parentElement;
  while(scroll&&scroll!==document.body&&scroll!==document.documentElement){
    if(scroll.scrollHeight>scroll.clientHeight+120)break;
    scroll=scroll.parentElement;
  }
  const root=scroll&&scroll!==document.body&&scroll!==document.documentElement
    ?scroll:document.scrollingElement;
  const original=root?.scrollTop||0;
  let attempts=0,converged=false;
  if(root){
    root.scrollTop=0;
    await sleep(220);collect();
    let previous=-1,still=0;
    // Bounded scroll sweep helps with virtualized older messages.
    for(attempts=0;attempts<150;attempts++){
      const step=Math.max(350,Math.floor(root.clientHeight*.8));
      root.scrollTop=Math.min(root.scrollHeight,root.scrollTop+step);
      await sleep(120);
      collect();
      if(root.scrollTop===previous||root.scrollTop+root.clientHeight>=root.scrollHeight-3)still++;
      else still=0;
      previous=root.scrollTop;
      if(still>=3){converged=true;break;}
      if(found.size>=2500)break;
    }
    root.scrollTop=original;
  }
  return {conversation_id:'chatgpt:'+id,
    // Render order is the page's order, not a fabricated historical timestamp.
    records:[...found.values()],captured_count:found.size,
    traversal_finished:converged,partial:!converged||found.size>=2500};
}
