import {html,mountHTML} from '/_loc/core/index.mjs';
import {parseRichText} from '/_loc/core/rich-text.mjs';

const panel=document.getElementById('loc-feature-panel');
const scope=document.querySelector('.loc-layout')?.dataset.scope||'loc';
const route=location.pathname.split('/').filter(Boolean);
const section=(route.find(value=>['culture','statics','trace','search','manage','settings','work'].includes(value))||'home').replace('work','article');

function render(view){mountHTML(panel,view);}
function status(message){render(html('p',{role:'status','class':'loc-status'},message));}
async function read(kind,params={}){
  const query=new URLSearchParams({kind,scope,...params});
  const response=await fetch('/api/loc-framework?'+query,{credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!Array.isArray(result?.data)&&kind!=='overview')
    throw new Error(result?.error||'LOC 資料讀取失敗');
  return result.data;
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
  if(!['lo3rwang','lrunes'].includes(owner)||!/^[A-Za-z0-9]{8}$/.test(uid))
    return status('找不到指定作品');
  status('正在讀取作品…');
  const target='/api/loc-framework?'+new URLSearchParams({scope:owner,kind:'article',uid});
  const response=await fetch(target,{cache:'no-store',credentials:'omit'});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error(result?.error||'作品讀取失敗');
  const work=result?.data?.[0];
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
  const rows=await read('culture');
  const grouped=new Map();
  for(const row of rows){
    const year=String(row.date||'').slice(0,4);
    if(!/^\d{4}$/.test(year))continue;
    grouped.set(year,(grouped.get(year)||0)+Number(row.total||0));
  }
  renderBars([...grouped].map(([year,total])=>({year,total})),{category:'year',value:'total',max:200});
}
async function statics(){
  status('正在讀取統計資料…');
  const rows=await read('statics');
  renderBars(rows,{category:'site',value:'total'});
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
  status('正在搜尋…');
  const rows=await read('search',{q:query,limit:40,offset:page*40});
  const heading=html('p',{'class':'loc-status'},'搜尋結果：'+rows.length+' 筆');
  const list=html('ul',{'class':'loc-list'},...rows.map(searchResult));
  render(html('div',{},heading,list,
    ...(page>0?[html('button',{onClick:()=>search(page-1)},'上一頁')]:[]),
    ...(rows.length===40?[html('button',{onClick:()=>search(page+1)},'下一頁')]:[])));
}
let mapLoader=null;
function loadMaplibre(){
  // MapLibre 6 is ESM. Only the Trace page fetches this optional provider.
  if(!mapLoader)mapLoader=import('/_loc/vendor/maplibre-gl.mjs')
    .catch(error=>{mapLoader=null;throw error;});
  return mapLoader;
}
async function trace(){
  status('正在讀取空間定錨資料…');
  const rows=await read('trace');
  if(!rows.length)return status('目前沒有具備座標的公開空間定錨點');
  if(!document.getElementById('loc-native-map-style')){
    const css=document.createElement('link');
    css.id='loc-native-map-style';css.rel='stylesheet';
    css.href='/_loc/vendor/maplibre-gl.css';
    document.head.append(css);
  }
  const maplibregl=await loadMaplibre();
  const viewport=document.createElement('div');
  viewport.style.height='min(70vh,580px)';
  viewport.style.width='100%';
  panel.replaceChildren(viewport);
  const first=rows[0];
  const map=new maplibregl.Map({
    container:viewport,
    center:[first.longitude,first.latitude],zoom:6,pitch:45,
    style:{version:8,sources:{osm:{type:'raster',
      tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,
      attribution:'© OpenStreetMap contributors'}},
      layers:[{id:'osm',type:'raster',source:'osm'}]}
  });
  const bounds=new maplibregl.LngLatBounds();
  for(const row of rows){
    const coords=[row.longitude,row.latitude];
    bounds.extend(coords);
    const popup=new maplibregl.Popup({offset:20}).setText(row.place||row.title||'LOC 空間定錨');
    new maplibregl.Marker().setLngLat(coords).setPopup(popup).addTo(map);
  }
  map.on('load',()=>{
    if(rows.length>1)map.fitBounds(bounds,{padding:45,maxZoom:12,duration:0});
  });
  window.addEventListener('pagehide',()=>map.remove(),{once:true});
}
function settings(){
  const saved=(()=>{try{return sessionStorage.getItem('loc-native-color-mode')||'auto'}catch{return 'auto'}})();
  render(html('div',{},
    html('h2',{},'介面設定'),
    html('p',{},'設定僅儲存在目前瀏覽器分頁，不涉及帳號或資料庫。'),
    html('div',{'class':'loc-toolbar'},
      ...[['auto','跟隨系統'],['light','明亮'],['dark','深色']].map(([value,label])=>
        html('button',{type:'button','aria-pressed':String(saved===value),
          onClick:()=>{
            try{sessionStorage.setItem('loc-native-color-mode',value)}catch{}
            applyColorMode(value);settings();
          }},label)
      )
    )));
}
function applyColorMode(mode){
  document.documentElement.dataset.colorMode=mode;
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
