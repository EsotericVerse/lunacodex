// LOC 網站／舊對話頁面的可見 DOM 擷取；不呼叫 OAuth、Clerk 或 MCP。
(() => {
  if (globalThis.__locCaptureV2) return;
  const state = {mode:'idle', root:null, observer:null, intersection:null, timer:null, hover:null, seen:new Set()};
  const visible = el => {
    if (!(el instanceof Element)) return false;
    const style=getComputedStyle(el);
    return style.display!=='none' && style.visibility!=='hidden' && el.getClientRects().length>0;
  };
  const normalizeUrl = value => {
    try {
      const url=new URL(value,location.href);
      if(!/^https?:$/.test(url.protocol))return null;
      url.hash='';
      for(const key of [...url.searchParams.keys()])if(/^utm_|^fbclid$|^igshid$/i.test(key))url.searchParams.delete(key);
      return url.href;
    } catch { return null; }
  };
  const cleanText = el => String(el?.innerText||el?.textContent||'')
    .replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').trim().slice(0,1400000);
  const links = el => [...el.querySelectorAll('a[href]')]
    .filter(visible).slice(0,120).map(a=>({text:cleanText(a).slice(0,120),url:normalizeUrl(a.href)}))
    .filter(x=>x.url);
  const stableSource = el => {
    const match=[...el.querySelectorAll('a[href]')].find(a=>{
      const u=normalizeUrl(a.href);
      return u && (/instagram\.com\/p\/|instagram\.com\/reel\/|threads\.(?:net|com)\/@[^/]+\/post\//i.test(u));
    });
    return normalizeUrl(match?.href||location.href);
  };
  function conversationTurns(scope){
    const nodes=[...scope.querySelectorAll('[data-message-id], [data-testid^="conversation-turn-"], [data-message-author-role]')];
    const hits=[]; const visited=new Set();
    for(const node of nodes){
      const parent=node.closest('[data-testid^="conversation-turn-"]')||node.closest('[data-message-id]')||node;
      if(visited.has(parent)||!visible(parent))continue; visited.add(parent);
      const roleNode=parent.matches('[data-message-author-role]')?parent:parent.querySelector('[data-message-author-role]');
      const role=roleNode?.getAttribute('data-message-author-role')||parent.getAttribute('data-message-author-role')||
        (parent.querySelector('[data-testid*="user"]')?'user':'');
      if(!['user','assistant'].includes(role))continue;
      const text=cleanText(parent);
      if(!text)continue;
      hits.push({key:parent.getAttribute('data-message-id')||parent.getAttribute('data-testid')||role+':'+text.slice(0,150),
        source_key:normalizeUrl(location.href),url:normalizeUrl(location.href),title:document.title,
        content:'['+role+']\n'+text+'\n'+links(parent).map(x=>x.text+' <'+x.url+'>').join('\n')});
    }
    return hits;
  }
  function extract(scope, mode='capture'){
    const doc=scope||document.body;
    const hostname=location.hostname.toLowerCase();
    if(/(?:chatgpt\.com|claude\.ai|chat\.openai\.com)$/.test(hostname)){
      const turns=conversationTurns(doc);
      if(turns.length)return turns;
    }
    const articles=[...doc.querySelectorAll('article,[role="article"]')]
      .filter(el=>visible(el)&&cleanText(el).length>=25);
    const cards=(articles.length?articles:[doc]).slice(0,100);
    return cards.map((el,index)=>{
      const source=stableSource(el);
      const text=cleanText(el);
      if(!source||!text)return null;
      const hrefs=links(el).map(x=>x.text+' <'+x.url+'>').join('\n');
      const date=el.querySelector('time[datetime]')?.getAttribute('datetime');
      return {key:source+'#'+index,source_key:source,url:source,
        title:el.querySelector('h1,h2,h3')?.textContent?.trim()||document.title,
        content:(date?'[時間] '+date+'\n':'')+text+(hrefs?'\n[連結]\n'+hrefs:'')};
    }).filter(Boolean);
  }
  function publish(items){
    const fresh=items.filter(x=>{
      const k=x.key+'\u0000'+x.content;
      if(state.seen.has(k))return false;
      state.seen.add(k);return true;
    });
    if(fresh.length)chrome.runtime.sendMessage({type:'items.captured',items:fresh}).catch(()=>{});
  }
  function scan(){
    if(!state.root||state.mode!=='record')return;
    if(state.timer)clearTimeout(state.timer);
    state.timer=setTimeout(()=>publish(extract(state.root,'record')),350);
  }
  function stop(){
    state.observer?.disconnect();state.intersection?.disconnect();
    state.observer=null;state.intersection=null;
    if(state.timer)clearTimeout(state.timer);
    state.timer=null;state.mode='idle';
    state.hover?.remove();state.hover=null;
    document.removeEventListener('mousemove',move,true);
    document.removeEventListener('click',choose,true);
  }
  function move(event){
    if(state.mode!=='select'&&state.mode!=='pick-record')return;
    const el=event.target.closest('article,[role="article"],main,section')||event.target;
    if(el instanceof Element&&visible(el)){
      const rect=el.getBoundingClientRect();
      if(!state.hover){state.hover=document.createElement('div');state.hover.style.cssText=
        'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:#3b82f61a;box-sizing:border-box';
        document.documentElement.append(state.hover);}
      Object.assign(state.hover.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    }
  }
  function choose(event){
    if(state.mode!=='select'&&state.mode!=='pick-record')return;
    event.preventDefault();event.stopImmediatePropagation();
    const root=event.target.closest('article,[role="article"],main,section')||event.target;
    if(!(root instanceof Element))return;
    const recording=state.mode==='pick-record';
    stop();state.root=root;state.seen.clear();
    if(recording){
      state.mode='record';
      publish(extract(root));
      state.observer=new MutationObserver(scan);
      state.observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:false});
      state.intersection=new IntersectionObserver(scan,{threshold:0});
      for(const node of root.querySelectorAll('article,[role="article"]'))state.intersection.observe(node);
      window.addEventListener('scroll',scan,{passive:true,once:true});
    }else publish(extract(root));
  }
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(msg.type==='page.capture'){
      const text=msg.selection?.trim();
      const items=text?[{key:'selection',source_key:normalizeUrl(location.href),url:normalizeUrl(location.href),
        title:document.title,content:text}]:extract(document.body);
      reply({items});return;
    }
    if(msg.type==='page.select'||msg.type==='page.record'){
      stop();state.mode=msg.type==='page.select'?'select':'pick-record';
      document.addEventListener('mousemove',move,true);
      document.addEventListener('click',choose,true);
      reply({ok:true});return;
    }
    if(msg.type==='page.stop'){const count=state.seen.size;stop();reply({ok:true,count});return;}
  });
  globalThis.__locCaptureV2=true;
})();
