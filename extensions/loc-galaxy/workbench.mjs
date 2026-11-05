const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const scopeid=new URL(location.href).searchParams.get('scopeid')||'';
const byId=id=>document.getElementById(id);
const connection=byId('connection'),message=byId('message'),results=byId('results');
const searchForm=byId('search-form'),queryInput=byId('query'),searchButton=byId('search');
const article=byId('article'),title=byId('article-title'),meta=byId('article-meta');
const body=byId('article-content'),more=byId('more');
const actions=['open-import','open-bulk','open-article'];
let ready=false,busy=false,current=null,nextOffset=null;

async function send(type,params={}){
  const answer=await chrome.runtime.sendMessage({type,scopeid,...params});
  if(answer?.ok!==true)throw Error(answer?.error||'LOC Galaxy 無法回應');
  return answer.data||{};
}
function notice(text,isError=false){
  message.textContent=text;
  message.style.color=isError?'#9a2d2d':'#555';
}
function setBusy(value){
  busy=value;
  searchButton.disabled=!ready||value;
  queryInput.disabled=!ready||value;
  for(const id of actions)byId(id).disabled=!ready||value;
  more.disabled=!ready||value;
}
function closeArticle(){
  article.hidden=true;current=null;nextOffset=null;
  title.textContent='';meta.textContent='';body.textContent='';
  more.hidden=true;
}
async function loadArticle(uid,offset=0){
  if(busy)return;
  setBusy(true);
  try{
    const data=await send('locGalaxy.galaxy',{action:'read',source:'mcp',uid,offset});
    if(data.found!==true)throw Error('文章不存在或沒有讀取權限');
    if(offset===0){
      article.hidden=false;
      title.textContent=String(data.title||uid);
      meta.textContent=String(data.date||data.createtime||'')+' · '+uid;
      body.textContent=String(data.content||'');
    }else body.textContent+=String(data.content||'');
    current=uid;
    const next=data.next_offset;
    nextOffset=Number.isInteger(next)&&next>offset?next:null;
    more.hidden=nextOffset===null;
    notice('已讀取授權的 Galaxy 文章片段。');
  }catch(error){notice(String(error.message||error),true);}
  finally{setBusy(false);}
}
function drawResults(data){
  results.replaceChildren();
  const rows=Array.isArray(data.results)?data.results:[];
  if(!rows.length){notice('沒有符合的 MCP 話題。');return;}
  for(const row of rows){
    const uid=String(row?.uid||'');
    if(!/^[A-Za-z0-9]{8}$/.test(uid))continue;
    const button=document.createElement('button');
    button.type='button';
    const head=document.createElement('strong');
    head.textContent=String(row.title||uid);
    const caption=document.createElement('span');
    caption.textContent=[row.date||row.createtime||'',uid].filter(Boolean).join(' · ');
    button.append(head,caption);
    button.addEventListener('click',()=>loadArticle(uid));
    results.append(button);
  }
  notice('找到 '+results.childElementCount+' 篇話題。點擊標題後才讀取正文。');
}
async function runSearch(event){
  event.preventDefault();
  if(!ready||busy)return;
  const query=queryInput.value.trim();
  if(query.length<2||query.length>100){notice('請輸入 2–100 字的搜尋詞',true);return;}
  setBusy(true);closeArticle();results.replaceChildren();
  notice('正在查詢已授權的 MCP 話題…');
  try{
    const data=await send('locGalaxy.galaxy',{action:'search',source:'mcp',query});
    drawResults(data);
  }catch(error){notice(String(error.message||error),true);}
  finally{setBusy(false);}
}
async function navigate(mode){
  if(!ready||busy)return;
  try{
    const result=await send('locGalaxy.openWorkspace',{mode});
    if(result.opened!==true)throw Error('無法開啟 LOC 管理頁');
    notice('已在新分頁開啟 '+(mode==='import'?'資料匯入':mode==='bulk'?'大量更新':'文章管理')+'。');
  }catch(error){notice(String(error.message||error),true);}
}
searchForm.addEventListener('submit',runSearch);
byId('close-article').addEventListener('click',closeArticle);
more.addEventListener('click',()=>{if(current&&nextOffset!==null)void loadArticle(current,nextOffset);});
for(const [id,mode] of [['open-import','import'],['open-bulk','bulk'],['open-article','article']])
  byId(id).addEventListener('click',()=>navigate(mode));

async function start(){
  if(!SCOPE.test(scopeid)){
    connection.textContent='無效的 Scope ID；請重新從 Extension 小視窗開啟工作台。';
    return;
  }
  try{
    const state=await send('locGalaxy.status');
    if(!state.ready||state.scopeid!==scopeid)throw Error('Scope 尚未授權，請返回 Extension 完成 OAuth');
    ready=true;
    connection.textContent='已授權 · Scope '+scopeid+' · Clerk '+String(state.subject||'');
    setBusy(false);
    notice('可查詢已授權的 MCP 對話，或開啟文章工作區。');
  }catch(error){
    connection.textContent=String(error.message||error);
    notice('未獲得授權；所有寫入與讀取功能已停用。',true);
  }
}
void start();
