// Runs only after an explicit user action on one ChatGPT conversation tab.
// Read rendered DOM only; no ChatGPT private APIs, cookies or network requests.
export async function extractOpenConversation(){
  const id=/^\/(?:g\/[^/]+\/)?c\/([a-zA-Z0-9-]{8,})/.exec(location.pathname)?.[1];
  if(location.origin!=='https://chatgpt.com'||!id)
    throw Error('請先開啟 chatgpt.com 的單一對話頁面');
  const found=new Map();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const selector='[data-testid^="conversation-turn-"],[data-message-id]';
  function collect(){
    for(const node of document.querySelectorAll(selector)){
      // Modern ChatGPT nests message IDs inside conversation-turn wrappers.
      // Treat the complete turn as one message, never import the same text twice.
      const turn=node.matches('[data-testid^="conversation-turn-"]')
        ?node:node.closest('[data-testid^="conversation-turn-"]');
      if(turn&&turn!==node)continue;
      const roleNode=node.matches('[data-message-author-role]')
        ?node:node.querySelector('[data-message-author-role]');
      const role=node.getAttribute('data-message-author-role')||
        roleNode?.getAttribute('data-message-author-role');
      if(!['user','assistant'].includes(role))continue;
      const turnId=node.getAttribute('data-testid')||'';
      const index=/^conversation-turn-(\d+)$/.exec(turnId)?.[1];
      // Turn index is stable within one conversation; unlike a content hash it
      // distinguishes repeated identical replies and is consistent across scans.
      const message_id=index!==undefined?'turn-'+index.padStart(8,'0'):
        node.getAttribute('data-message-id')||
        node.querySelector('[data-message-id]')?.getAttribute('data-message-id');
      if(!message_id||!/^[A-Za-z0-9-]{8,}$/.test(message_id)||found.has(message_id))continue;
      const anchor=roleNode||node;
      const content=anchor.querySelector('.markdown')||
        anchor.querySelector('.whitespace-pre-wrap')||
        node.querySelector('.markdown')||
        node.querySelector('.whitespace-pre-wrap')||anchor;
      const text=String(content.innerText||content.textContent||'').trim();
      if(!text||text.length>80000)continue;
      found.set(message_id,{message_id,role,kind:role==='user'?'original':'advice',text});
    }
  }
  collect();
  const first=document.querySelector(selector);
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
    for(attempts=0;attempts<150;attempts++){
      const step=Math.max(350,Math.floor(root.clientHeight*.8));
      root.scrollTop=Math.min(root.scrollHeight,root.scrollTop+step);
      await sleep(120);collect();
      if(root.scrollTop===previous||root.scrollTop+root.clientHeight>=root.scrollHeight-3)still++;
      else still=0;
      previous=root.scrollTop;
      if(still>=3){converged=true;break;}
      if(found.size>=2500)break;
    }
    root.scrollTop=original;
  }
  const turnCount=document.querySelectorAll('[data-testid^="conversation-turn-"]').length;
  const idCount=document.querySelectorAll('[data-message-id]').length;
  if(!found.size)
    throw Error('ChatGPT 頁面沒有可辨識的對話文字（turn='+turnCount+
      '、message='+idCount+'）；請確認對話已顯示，勿將掃描 0 則當成匯入完成');
  return {conversation_id:'chatgpt:'+id,
    records:[...found.values()],captured_count:found.size,
    traversal_finished:converged,partial:!converged||found.size>=2500};
}
