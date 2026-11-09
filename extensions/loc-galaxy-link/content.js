// LOC 網站／舊對話頁面的可見 DOM 擷取；不呼叫 OAuth 或 MCP。
(() => {
  if (globalThis.__locCaptureV2) return;
  const state = {mode:'idle', root:null, observer:null, intersection:null, timer:null, hover:null, includeAssistant:false, seen:new Set(), sending:new Set(), emptyReported:false};
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
  const inViewport = el => {
    const rect=el.getBoundingClientRect();
    return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight;
  };
  const socialPostUrl = url =>
    /instagram\.com\/(?:p|reel|tv)\/|threads\.(?:net|com)\/@[^/]+\/post\//i.test(String(url||''));
  const links = el => [...el.querySelectorAll('a[href]')]
    .filter(visible).slice(0,120).map(a=>({text:cleanText(a).slice(0,120),url:normalizeUrl(a.getAttribute('href'))}))
    .filter(x=>x.url);
  const stableSource = el => {
    const match=[...el.querySelectorAll('a[href]')].find(a=>{
      const u=normalizeUrl(a.href);
      return u&&socialPostUrl(u);
    });
    if(match)return normalizeUrl(match.href);
    if(socialPostUrl(location.href))return normalizeUrl(location.href);
    // Never merge unrelated social-feed posts into the profile/feed URL
    // when a stable individual post permalink is not present.
    if(/(?:instagram\.com|threads\.(?:net|com))$/.test(location.hostname.toLowerCase()))
      return null;
    return normalizeUrl(location.href);
  };
  // ChatGPT and Claude change markup independently. Identify a message turn by
  // its role metadata or the semantic labels on the rendered conversation
  // article, not only by one generation of data-message-author-role.
  const TURN_SELECTOR='[data-message-id],[data-testid^="conversation-turn-"],'+
    '[data-message-author-role],[data-testid="user-message"],'+
    '[data-testid="assistant-message"],article[aria-label]';
  const TURN_CONTAINER='[data-testid^="conversation-turn-"],[data-message-id],'+
    'article[data-message-author-role],[data-testid="user-message"],'+
    '[data-testid="assistant-message"]';
  function roleOf(turn){
    const node=turn.matches?.('[data-message-author-role]')?turn:
      turn.querySelector?.('[data-message-author-role]');
    const value=(node?.getAttribute?.('data-message-author-role')||
      turn.getAttribute?.('data-message-author-role')||'').toLowerCase();
    if(value==='user'||value==='assistant')return value;
    const testid=(turn.getAttribute?.('data-testid')||'').toLowerCase();
    if(testid==='user-message')return 'user';
    if(testid==='assistant-message')return 'assistant';
    const label=(turn.getAttribute?.('aria-label')||'').toLowerCase();
    // sr-only headings are deliberately invisible but provide reliable
    // accessible role semantics in modern ChatGPT conversation turns.
    const headings=[...(turn.querySelectorAll?.('h5,h6,[class*="sr-only"]')||[])];
    const visibleLabels=(label+' '+headings.slice(0,8)
      .map(n=>String(n.textContent||n.innerText||'').trim()).join(' ')).toLowerCase();
    if(/you said|你說|你说|您說|您说|user message|human:/.test(visibleLabels))
      return 'user';
    if(/chatgpt said|claude said|assistant message|assistant:/.test(visibleLabels))
      return 'assistant';
    if(turn.querySelector?.('[data-testid*="user"]'))return 'user';
    return '';
  }
  function conversationTurns(scope,includeAssistant=false){
    const nodes=[...(scope.matches?.(TURN_SELECTOR)?[scope]:[]),
      ...(scope.querySelectorAll?.(TURN_SELECTOR)||[])];
    const hits=[],visited=new Set(),url=normalizeUrl(location.href);
    for(const node of nodes){
      const turn=node.closest?.(TURN_CONTAINER)||node.closest?.('article')||node;
      if(visited.has(turn)||!visible(turn))continue;visited.add(turn);
      const role=roleOf(turn);
      if(!['user','assistant'].includes(role)||role==='assistant'&&!includeAssistant)continue;
      // The role's own message body is preferable to the container's
      // toolbars/feedback buttons, which are not conversation content.
      const roleNode=turn.matches?.('[data-message-author-role]')?turn:
        turn.querySelector?.('[data-message-author-role]');
      const text=cleanText(roleNode||turn);
      if(!text)continue;
      hits.push({key:turn.getAttribute?.('data-message-id')||
          turn.getAttribute?.('data-testid')||role+':'+text.slice(0,150),
        source_key:url,url,title:document.title,
        content:'['+role+']\n'+text+'\n'+links(turn).map(x=>x.text+' <'+x.url+'>').join('\n')});
    }
    if(hits.length)return hits;
    // ChatGPT may render a user's message as a whitespace-pre-wrap bubble
    // with no role attributes or conversation-turn IDs. Restrict this
    // fallback to the main conversation and user-bubble shapes only;
    // never silently archive the sidebar or reclassify AI replies as user.
    if(/(?:^|\.)chatgpt\.com$|(?:^|\.)chat\.openai\.com$/.test(location.hostname.toLowerCase())){
      // A selected area must not unexpectedly expand into the whole chat.
      // Full-page/recording paths already pass their main conversation root.
      const region=scope===document.body?
        document.querySelector?.('main')||scope:scope;
      if(!region||!(region===document.body||region.closest?.('main')||
        region.matches?.('main')||region.querySelector?.('main')))return [];
      const bubbles=[...(region.matches?.('[data-testid="user-message"],.whitespace-pre-wrap')?[region]:[]),
        ...(region.querySelectorAll?.('[data-testid="user-message"],.whitespace-pre-wrap')||[])];
      for(const bubble of bubbles){
        if(!visible(bubble)||bubble.closest?.('nav,aside,form,[role="navigation"],[contenteditable="true"]'))continue;
        const turn=bubble.closest?.('[data-testid^="conversation-turn-"],article')||bubble;
        if(visited.has(turn)||roleOf(turn)==='assistant')continue;
        const text=cleanText(bubble);
        if(!text)continue;
        visited.add(turn);
        hits.push({key:turn.getAttribute?.('data-testid')||
          'user-bubble:'+text.slice(0,150),source_key:url,url,title:document.title,
          content:'[user]\n'+text});
      }
    }
    return hits;
  }
  function extract(scope, mode='capture',includeAssistant=state.includeAssistant){
    const doc=scope||document.body;
    const hostname=location.hostname.toLowerCase();
    if(/(?:chatgpt\.com|claude\.ai|chat\.openai\.com)$/.test(hostname)){
      // Full-page capture and recording use the full current conversation.
      // An explicit area selection stays limited to the selected element.
      const region=mode==='record'||doc===document.body?
        (doc.closest?.('main')||doc.querySelector?.('main')||doc):doc;
      const turns=conversationTurns(region,includeAssistant);
      // Chat exports contain only actually rendered, role-attributed messages.
      // Never silently archive website navigation or other UI as a conversation.
      return turns;
    }
    // Readability is invoked only for a full-page single capture; avoid destroying
    // the live DOM or re-parsing every MutationObserver notification during recording.
    if(mode==='capture'&&doc===document.body&&typeof Readability==='function'&&
      !/(?:instagram\.com|threads\.(?:net|com)|chatgpt\.com|claude\.ai|chat\.openai\.com)$/.test(hostname)){
      try{
        const parsed=new Readability(document.cloneNode(true)).parse();
        if(parsed?.textContent?.trim()?.length>100){
          const documentFragment=new DOMParser().parseFromString(parsed.content||'','text/html');
          const hrefs=[...documentFragment.querySelectorAll('a[href]')].slice(0,120)
            .map(a=>({text:a.textContent?.trim()||'',url:normalizeUrl(a.href)}))
            .filter(x=>x.url).map(x=>x.text+' <'+x.url+'>').join('\n');
          const url=normalizeUrl(location.href);
          return [{key:url,source_key:url,url,title:parsed.title||document.title,
            content:parsed.textContent.trim()+(hrefs?'\n[連結]\n'+hrefs:'')}];
        }
      }catch{ /* Unsupported or dynamic page: use bounded DOM fallback below. */ }
    }
    const articles=[...doc.querySelectorAll('article,[role="article"],[data-testid="post-container"]')]
      .filter(el=>visible(el)&&(mode!=='record'||inViewport(el))&&cleanText(el).length>=25);
    // Threads may render cards as generic DIVs rather than <article>.
    // Follow only already-rendered permanent links; never invent a source
    // or treat the whole infinite feed as a single post.
    if(/(?:instagram\.com|threads\.(?:net|com))$/.test(hostname)){
      for(const a of [...doc.querySelectorAll('a[href]')].slice(0,500)){
        if(!socialPostUrl(normalizeUrl(a.href)))continue;
        const parent=a.closest('article,[role="article"],[data-testid="post-container"]')||
          a.closest('[data-pressable-container]')||a.parentElement?.parentElement?.parentElement;
        if(parent&&visible(parent)&&(mode!=='record'||inViewport(parent))&&
          cleanText(parent).length>=25)articles.push(parent);
      }
    }
    const unique=[...new Set(articles)];
    const cards=(unique.length?unique:(mode==='record'?[]:[doc])).slice(0,50);
    return cards.map((el,index)=>{
      const source=stableSource(el);
      const text=cleanText(el);
      if(!source||!text)return null;
      const hrefs=links(el).map(x=>x.text+' <'+x.url+'>').join('\n');
      const media=[...el.querySelectorAll('img[src],video[src],video[poster],source[src]')]
        .filter(visible).slice(0,24).map(node=>
          normalizeUrl(node.currentSrc||node.src||node.getAttribute('poster')||''))
        .filter(Boolean);
      const mediaText=[...new Set(media)].map(u=>'<'+u+'>').join('\n');
      const date=el.querySelector('time[datetime]')?.getAttribute('datetime');
      return {key:source,source_key:source,url:source,
        title:el.querySelector('h1,h2,h3')?.textContent?.trim()||document.title,
        content:(date?'[時間] '+date+'\n':'')+text+(hrefs?'\n[連結]\n'+hrefs:'')+
          (mediaText?'\n[媒體來源]\n'+mediaText:'')};
    }).filter(Boolean);
  }
  function fingerprint(value){
    const text=String(value||'');
    let a=2166136261,b=16777619;
    for(let i=0;i<text.length;i++){
      const code=text.charCodeAt(i);
      a=Math.imul(a^code,16777619);
      b=Math.imul(b+code,2246822519);
    }
    return text.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16);
  }
  async function reportCapture(message,ok=false){
    feedback(message,ok);
    try{await chrome.runtime.sendMessage({type:'capture.report',
      message:String(message).slice(0,350),ok});}catch{}
  }
  async function publish(items){
    // A running observer is not proof of a saved capture.
    const pending=[];
    for(const item of items){
      const key=item.source_key+':'+fingerprint(item.content);
      if(state.seen.has(key)||state.sending.has(key))continue;
      state.sending.add(key);pending.push({item,key});
    }
    if(!pending.length)return {accepted:0,queued:false};
    try{
      const result=await chrome.runtime.sendMessage({
        type:'items.captured',items:pending.map(({item})=>item)
      });
      if(result?.error)throw Error(result.error);
      if(!result||typeof result.queued!=='number')
        throw Error('LOC Queue 沒有回傳入列確認');
      if(state.seen.size>=5000)state.seen.clear();
      for(const {key} of pending)state.seen.add(key);
      state.emptyReported=false;
      return {accepted:pending.length,queued:result.queued};
    }catch(error){
      // The previous implementation swallowed this exception, leaving a
      // misleading "recording" state with Queue 0 forever.
      const reason=String(error?.message||error);
      void reportCapture('錄製擷取失敗，Queue 未確認寫入：'+reason,false);
      return {accepted:0,error:reason};
    }finally{
      for(const {key} of pending)state.sending.delete(key);
    }
  }
  function scan(){
    if(!state.root||state.mode!=='record')return;
    if(state.timer)clearTimeout(state.timer);
    state.timer=setTimeout(()=>{
      if(state.mode!=='record')return;
      const items=extract(state.root,'record',state.includeAssistant);
      if(!items.length){
        if(!state.emptyReported){
          state.emptyReported=true;
          void reportCapture('錄製已啟動，但目前找不到可辨識的對話訊息；Queue 仍是 0。請確認對話已載入。',false);
        }
        return;
      }
      void publish(items);
    },350);
  }
  function stopWatching(){
    state.observer?.disconnect();state.intersection?.disconnect();
    state.observer=null;state.intersection=null;
    window.removeEventListener('scroll',scan);
    if(state.timer)clearTimeout(state.timer);
    state.timer=null;
  }
  function watch(){
    if(!state.root)return false;
    stopWatching();
    state.mode='record';
    state.observer=new MutationObserver(scan);
    state.observer.observe(state.root,{childList:true,subtree:true,characterData:true,attributes:false});
    state.intersection=new IntersectionObserver(scan,{threshold:0});
    for(const node of state.root.querySelectorAll('article,[role="article"]'))
      state.intersection.observe(node);
    window.addEventListener('scroll',scan,{passive:true});
    scan();
    return true;
  }
  function stop(){
    stopWatching();state.mode='idle';state.emptyReported=false;
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
    const target=event.target;
    const recording=state.mode==='pick-record';
    const chat=/^(?:chatgpt\.com|chat\.openai\.com|claude\.ai)$/.test(location.hostname);
    const main=recording&&chat&&(target.closest?.('main')||document.querySelector?.('main'));
    const root=main||(state.mode==='pick-record'?
      (target.closest('[role="feed"],main,section')||target.closest('article,[role="article"]')?.parentElement||target):
      (target.closest('article,[role="article"],main,section')||target));
    if(!(root instanceof Element))return;
    stop();state.root=root;state.seen.clear();state.emptyReported=false;
    if(recording){
      // Record the current loaded turns immediately, then observe changes.
      // Do not announce captured data until background acknowledges Queue.
      watch();
    }else{
      const items=extract(root,'capture',state.includeAssistant);
      if(!items.length)void reportCapture('選取區域內沒有可擷取內容，Queue 未變動',false);
      else void publish(items);
    }
  }
  function feedback(message,ok=false){
    const id='loc-galaxy-link-status';
    let notice=document.getElementById(id);
    if(!notice){
      notice=document.createElement('div');notice.id=id;
      notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
      notice.style.cssText='position:fixed;bottom:18px;right:18px;max-width:min(390px,85vw);'+
        'padding:10px 14px;border-radius:9px;background:#222;color:#fff;'+
        'font:14px/1.5 system-ui;box-shadow:0 3px 16px #0004;z-index:2147483647;'+
        'white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none';
      document.documentElement.appendChild(notice);
    }
    notice.textContent=String(message||'LOC 擷取狀態').slice(0,450);
    notice.style.borderLeft=ok?'4px solid #52bd8b':'4px solid #ea766e';
    clearTimeout(feedback.timer);
    feedback.timer=setTimeout(()=>notice?.remove(),6500);
  }
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(msg.type==='page.feedback'){feedback(msg.message,msg.ok===true);reply({ok:true});return;}
    if(msg.type==='page.capture'){
      const text=msg.selection?.trim();
      const items=text?[{key:'selection',source_key:normalizeUrl(location.href),url:normalizeUrl(location.href),
        title:document.title,content:text}]:extract(document.body,'capture',Boolean(msg.includeAssistant));
      reply({items});return;
    }
    if(msg.type==='page.select'||msg.type==='page.record'){
      stop();state.mode=msg.type==='page.select'?'select':'pick-record';
      state.includeAssistant=msg.includeAssistant===true;
      document.addEventListener('mousemove',move,true);
      document.addEventListener('click',choose,true);
      reply({ok:true});return;
    }
    if(msg.type==='page.pause'){
      if(state.mode!=='record'){reply({ok:false,mode:state.mode});return;}
      stopWatching();state.mode='paused';reply({ok:true,mode:'paused'});return;
    }
    if(msg.type==='page.resume'){
      const ok=state.mode==='paused'&&watch();
      reply({ok:Boolean(ok),mode:state.mode});return;
    }
    if(msg.type==='page.status'){reply({ok:true,mode:state.mode,count:state.seen.size});return;}
    if(msg.type==='page.stop'){const count=state.seen.size;stop();reply({ok:true,count});return;}
  });
  globalThis.__locCaptureV2=true;
})();
