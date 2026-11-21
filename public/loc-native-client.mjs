import {html,mountHTML,createLOC} from '/_loc/core/index.mjs';
const LOC=createLOC();
LOC.components.register('status',({message})=>html('p',{role:'status','class':'loc-status'},message));
import {parseRichText} from '/_loc/core/rich-text.mjs';

const panel=document.getElementById('loc-feature-panel');
const scope=document.querySelector('.loc-layout')?.dataset.scope||'loc';
const route=location.pathname.split('/').filter(Boolean);
const section=(route.find(value=>['culture','statics','trace','search','manage','settings','work'].includes(value))||'home').replace('work','article');

function render(view){mountHTML(panel,view);}
function status(message){LOC.components.mount(panel,'status',{message});}
const PUBLIC_SCOPES=['lo3rwang','lrunes'];
const firstDay='0001-01-01',lastDay='9999-12-31';
async function publicRequest(url,{method='GET',body}={}){
  const response=await fetch(url,{
    method,credentials:'omit',cache:'no-store',redirect:'error',
    headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(15000)
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error||'LOC 公開資料讀取失敗（HTTP '+response.status+'）');
  if(payload==null||!Object.hasOwn(payload,'data'))
    throw new Error('LOC 公開資料回傳格式錯誤');
  return payload.data;
}
async function publicContent(kind,target,dates=false){
  const params=new URLSearchParams({kind,scope:target});
  if(dates){params.set('start',firstDay);params.set('end',lastDay);}
  return publicRequest('/api/loc-public-content?'+params);
}
async function publicQuery(body){
  return publicRequest('/api/loc-public-query',{method:'POST',body});
}
async function publicAnalytics(view,target){
  return publicQuery({kind:'analytics',args:{
    p_scope_id:target,p_view:view,p_start:null,p_end:null,p_options:{}
  }});
}
async function publicSelect(target,kind,columns,filters=[],{limit=40,offset=0,orFilters=[]}={}){
  if(!PUBLIC_SCOPES.includes(target)||!['galaxy','anchor'].includes(kind))
    throw new TypeError('Unknown LOC public Scope/relation');
  return publicQuery({schema:'silver',table:target+'_'+kind,columns,filters,
    orFilters,orders:[],limit,offset,head:false,count:null,cardinality:null});
}

function cleanDate(value){
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'}):'';
}
function svgNode(tag,attrs={},text=null){
  const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [name,value] of Object.entries(attrs))element.setAttribute(name,String(value));
  if(text!=null)element.textContent=String(text);
  return element;
}
function renderBars(rows,{category,value,max=20}){
  const values=rows.filter(row=>Number(row[value])>0)
    .sort((a,b)=>Number(b[value])-Number(a[value])).slice(0,max);
  if(!values.length)return status('目前沒有可顯示的資料');
  const width=980,left=220,right=80,bar=26,gap=11;
  const height=Math.max(130,values.length*(bar+gap)+24);
  const chart=svgNode('svg',{viewBox:'0 0 '+width+' '+height,
    class:'loc-chart',role:'img','aria-label':'LOC '+category+' 分布圖'});
  const peak=Math.max(...values.map(row=>Number(row[value])),1);
  values.forEach((row,i)=>{
    const y=i*(bar+gap)+12;
    const label=String(row[category]||'未分類');
    chart.append(
      svgNode('text',{x:left-10,y:y+18,'text-anchor':'end',fill:'currentColor','font-size':15},
        label.length>21?label.slice(0,20)+'…':label),
      svgNode('rect',{x:left,y,width:(width-left-right)*Number(row[value])/peak,
        height:bar,rx:6,fill:'var(--accent)'}),
      svgNode('text',{x:left+Math.min(width-left-right-28,
          (width-left-right)*Number(row[value])/peak+8),
        y:y+18,fill:'currentColor','font-size':14},Number(row[value]).toLocaleString())
    );
  });
  panel.replaceChildren(chart);
}
async function article(){
  const query=new URLSearchParams(location.search);
  const owner=query.get('scope')||'';
  const uid=query.get('uid')||'';
  if(!PUBLIC_SCOPES.includes(owner)||!/^[A-Za-z0-9]{8}$/.test(uid))
    return status('找不到指定作品');
  status('正在讀取作品…');
  const rows=await publicSelect(owner,'galaxy',
    ['uid','title','content','createtime','date','site'],
    [{column:'uid',op:'eq',value:uid},{column:'search',op:'eq',value:true}],
    {limit:1});
  const work=Array.isArray(rows)?rows[0]:null;
  if(!work)return status('找不到指定作品');
  render(html('article',{'class':'loc-work'},
    html('h2',{},work.title||'未命名作品'),
    html('p',{'class':'loc-status'},[owner,cleanDate(work.createtime||work.date),work.site]
      .filter(Boolean).join(' · ')),
    ...parseRichText(work.content||'')
  ));
}
async function culture(){
  status('正在讀取時間資料…');
  const source=scope==='loc'
    ?await publicContent('loc','loc')
    :await publicContent('culture_density',scope,true);
  const rows=Array.isArray(source)?source:source?.rows;
  if(!Array.isArray(rows))throw new Error('文化資料格式不符合 LOC 契約');
  const grouped=new Map();
  for(const row of rows){
    const year=String(row.day||'').slice(0,4);
    if(!/^\d{4}$/.test(year))continue;
    grouped.set(year,(grouped.get(year)||0)+Number(row.item_count||0));
  }
  renderBars([...grouped].map(([year,total])=>({year,total})),
    {category:'year',value:'total',max:200});
}
async function statics(){
  status('正在讀取統計資料…');
  if(scope==='loc'){
    const aggregate=await publicContent('loc','loc');
    if(!Array.isArray(aggregate?.rows))throw new Error('統計資料格式錯誤');
    const counters=new Map();
    for(const row of aggregate.rows)
      counters.set(row.scope_id,(counters.get(row.scope_id)||0)+Number(row.item_count||0));
    const labels=new Map((aggregate.scopes||[]).map(row=>[row.scope_id,row.display_name]));
    return renderBars([...counters].map(([id,total])=>({site:labels.get(id)||id,total})),
      {category:'site',value:'total'});
  }
  const rows=await publicContent('totals',scope);
  if(!Array.isArray(rows))throw new Error('統計資料格式錯誤');
  renderBars(rows.map(row=>({site:row.category||'未分類',total:Number(row.item_count||0)})),
    {category:'site',value:'total'});
}

function searchResult(row){
  return html('li',{},
    html('h3',{},html('a',{href:'/work/?scope='+encodeURIComponent(row.scope)+
      '&uid='+encodeURIComponent(row.uid)},row.title||'未命名作品')),
    html('small',{},[row.scope,cleanDate(row.createtime||row.date),row.site]
      .filter(Boolean).join(' · '))
  );
}
async function search(page=0){
  const form=document.getElementById('loc-search-form');
  const input=form?.querySelector('input[name=q]');
  const query=input?.value.trim()||'';
  if(!query){status('請輸入搜尋關鍵詞');return;}
  if(query.length>120)throw new Error('搜尋文字超過長度限制');
  status('正在搜尋…');
  const term=query.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\r\n\t]/g,' ');
  const scopes=scope==='loc'?PUBLIC_SCOPES:[scope];
  const results=await Promise.all(scopes.map(async target=>{
    const records=await publicSelect(target,'galaxy',
      ['uid','title','date','createtime','site'],
      [{column:'search',op:'eq',value:true}],
      {orFilters:['title.contains."'+term+'",content.contains."'+term+'"'],
        limit:40,offset:page*40});
    if(!Array.isArray(records))throw new Error('搜尋資料格式錯誤');
    return records.map(row=>({...row,scope:target}));
  }));
  const all=results.flat().sort((a,b)=>
    String(b.createtime||b.date||'').localeCompare(String(a.createtime||a.date||''))).slice(0,40);
  const heading=html('p',{'class':'loc-status'},'搜尋結果：'+all.length+' 筆');
  const list=html('ul',{},...all.map(searchResult));
  render(html('div',{},heading,list,
    ...(page>0?[html('button',{onClick:()=>void search(page-1).catch(showError)},'上一頁')]:[]),
    ...(results.some(rows=>rows.length===40)?
      [html('button',{onClick:()=>void search(page+1).catch(showError)},'下一頁')]:[])
  ));
}

let mapLoader=null;
function loadMaplibre(){
  // MapLibre 6 is ESM. Only the Trace page fetches this optional provider.
  if(!mapLoader)mapLoader=import('/_loc/vendor/maplibre-gl.mjs')
    .catch(error=>{mapLoader=null;throw error;});
  return mapLoader;
}
// A capability is a provider selected by LOC, not an application framework.
LOC.extensions.register('map',async()=>({
  async mount(viewport,{rows}){
    const maplibregl=await loadMaplibre();
    if(!document.getElementById('loc-native-map-style')){
      const css=document.createElement('link');
      css.id='loc-native-map-style';css.rel='stylesheet';
      css.href='/_loc/vendor/maplibre-gl.css';
      document.head.append(css);
    }
    const first=rows[0];
    const map=new maplibregl.Map({
      container:viewport,
      center:[first.longitude,first.latitude],zoom:6,pitch:45,
      style:{version:8,sources:{osm:{type:'raster',
        tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize:256,attribution:'© OpenStreetMap contributors'}},
        layers:[{id:'osm',type:'raster',source:'osm'}]}
    });
    const bounds=new maplibregl.LngLatBounds();
    for(const row of rows){
      const coords=[row.longitude,row.latitude];
      bounds.extend(coords);
      const popup=new maplibregl.Popup({offset:20})
        .setText(row.place||row.title||'LOC 空間定錨');
      new maplibregl.Marker().setLngLat(coords).setPopup(popup).addTo(map);
    }
    map.on('load',()=>{
      if(rows.length>1)map.fitBounds(bounds,{padding:45,maxZoom:12,duration:0});
    });
    return ()=>map.remove();
  }
}));
async function trace(){
  status('正在讀取空間定錨資料…');
  const scopes=scope==='loc'?PUBLIC_SCOPES:[scope];
  const all=await Promise.all(scopes.map(async target=>{
    const items=await publicSelect(target,'anchor',['uid','title','attr'],
      [{column:'type',op:'eq',value:'point'},{column:'invisible',op:'eq',value:false}],
      {limit:500});
    if(!Array.isArray(items))throw new Error('空間定錨資料格式錯誤');
    return items.flatMap(item=>{
      let attr=item.attr||{};
      if(typeof attr==='string'){try{attr=JSON.parse(attr)}catch{return [];}}
      const longitude=Number(attr?.longitude),latitude=Number(attr?.latitude);
      if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||
        Math.abs(longitude)>180||Math.abs(latitude)>90)return [];
      return [{longitude,latitude,place:item.title||attr.location||'LOC 空間定錨'}];
    });
  }));
  const rows=all.flat();
  if(!rows.length)return status('目前沒有具備座標的公開空間定錨點');
  const viewport=document.createElement('div');
  viewport.style.height='min(70vh,580px)';
  viewport.style.width='100%';
  panel.replaceChildren(viewport);
  const dispose=await LOC.extensions.mount('map',viewport,{rows});
  window.addEventListener('pagehide',dispose,{once:true});
}

function settings(){
  const saved=(()=>{try{return sessionStorage.getItem('loc-native-color-mode')||'auto'}catch{return 'auto'}})();
  render(html('div',{},
    html('h2',{},'介面設定'),
    html('p',{},'設定僅儲存在目前瀏覽器分頁，不涉及帳號或資料庫。'),
    html('div',{'class':'loc-toolbar'},
      ...[['auto','依時間自動'],['light','明亮'],['dark','深色']].map(([value,label])=>
        html('button',{type:'button','aria-pressed':String(saved===value),
          onClick:()=>{
            try{sessionStorage.setItem('loc-native-color-mode',value)}catch{}
            applyColorMode(value);settings();
          }},label)
      )
    )));
}
function applyColorMode(mode){
  let hour=new Date().getHours();
  try{
    const part=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'})
      .formatToParts(new Date()).find(part=>part.type==='hour');
    if(part)hour=Number(part.value);
  }catch{}
  document.documentElement.dataset.colorMode=mode==='auto'
    ?hour>=6&&hour<18?'light':'dark':mode;
}
function management(){
  render(html('section',{},
    html('h2',{},'資料管理'),
    html('p',{},'管理寫入必須經過伺服器驗證的 LOC Auth 授權。'),
    html('p',{'class':'loc-status'},'目前原生管理操作尚未開放，避免未授權寫入。')));
}
function init(){
  if(!panel)return;
  const current=(()=>{try{return sessionStorage.getItem('loc-native-color-mode')||'auto'}catch{return 'auto'}})();
  applyColorMode(current);
  if(section==='search'){
    const form=document.getElementById('loc-search-form');
    form?.addEventListener('submit',event=>{event.preventDefault();void search().catch(showError);});
    const initial=new URLSearchParams(location.search).get('q');
    if(initial){form?.querySelector('input[name=q]')?.setAttribute('value',initial);
      void search().catch(showError);}
    else status('請輸入關鍵詞搜尋公開作品');
    return;
  }
  const action={culture,statics,trace,article,manage:management,settings}[section];
  if(action)void Promise.resolve().then(action).catch(showError);
}
function showError(cause){status('LOC 功能暫時無法使用：'+String(cause?.message||cause));}
init();
