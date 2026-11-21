import {html,renderHTML} from '../core/index.mjs';
import {parseRichText} from '../core/rich-text.mjs';

// LOC's authored HTML is the only rendering path. Published blocks are content,
// not JSX components or an imported application framework.
export const SCOPES=Object.freeze({
  loc:{label:'LOC 月典',path:'/',theme:'theme-7'},
  lo3rwang:{label:'政德',path:'/lo3rwang/',theme:'theme-8'},
  lrunes:{label:'月之符文',path:'/lrunes/',theme:'theme-5'}
});
export const SECTIONS=Object.freeze({
  culture:'文化',statics:'統計',trace:'痕跡',search:'搜尋',manage:'管理',settings:'設定'
});
export function href(scope,section='home'){
  return SCOPES[scope].path+(section==='home'?'':section+'/');
}
function sourceImage(value){
  if(!value)return '';
  try{
    const parsed=typeof value==='string'?JSON.parse(value):value;
    return typeof parsed?.url==='string'?parsed.url:'';
  }catch{return '';}
}
function block(row,index){
  const image=sourceImage(row.block_image);
  const entities=Array.isArray(row.block_entity)?row.block_entity.filter(Boolean):[];
  return html('section',{'class':'loc-block'+(index===0?' loc-hero':'')},
    html('div',{'class':'loc-block-body'},
      row.block_eyebrow?html('p',{'class':'loc-eyebrow'},row.block_eyebrow):null,
      html(index===0?'h1':'h2',{},row.block_title||''),
      row.block_subtitle?html('p',{'class':'loc-subtitle'},row.block_subtitle):null,
      ...parseRichText(row.block_text||''),
      ...entities.map(child=>html('section',{'class':'loc-child'},
        child.title?html('h3',{},child.title):null,
        ...parseRichText(child.text||'')
      ))
    ),
    image?html('img',{'class':'loc-block-image',src:image,alt:row.block_title||'',loading:index===0?'eager':'lazy'}):null
  );
}
function shell(scope,section,body){
  const owner=SCOPES[scope];
  return html('div',{'class':'loc-layout','data-scope':scope},
    html('header',{'class':'loc-header'},
      html('a',{'class':'loc-brand',href:'/'},'LOC'),
      html('nav',{'aria-label':'Scope'},
        ...Object.entries(SCOPES).map(([key,value])=>
          html('a',{href:value.path,'aria-current':key===scope?'page':null},value.label)
        )
      )
    ),
    html('nav',{'class':'loc-nav','aria-label':'功能選單'},
      ...['home','culture','statics','trace','search','manage','settings'].map(key=>
        html('a',{href:href(scope,key),'aria-current':section===key?'page':null},key==='home'?'首頁':SECTIONS[key])
      )
    ),
    html('main',{id:'loc-content','class':'loc-main'},body),
    html('footer',{'class':'loc-footer'},
      html('small',{},'LOC Framework · HTML / Data Model / SQL Dialect / Components / Extensions')
    )
  );
}
export function pageView({scope='loc',section='home',rows=[]}={}){
  if(!Object.hasOwn(SCOPES,scope))throw new TypeError('Unknown LOC Scope');
  if(section!=='home'&&!Object.hasOwn(SECTIONS,section))
    throw new TypeError('Unknown LOC section');
  const title=section==='home'?SCOPES[scope].label:SECTIONS[section];
  const body=section==='home'
    ?html('article',{'class':'loc-home'},...rows
      .filter(row=>row.page_name==='index')
      .sort((a,b)=>Number(a.block_order)-Number(b.block_order))
      .map(block))
    :html('section',{'class':'loc-feature'},
      html('header',{'class':'loc-feature-header'},
        html('p',{'class':'loc-eyebrow'},SCOPES[scope].label),
        html('h1',{},title)
      ),
      ...(section==='search'?[
        html('form',{id:'loc-search-form','class':'loc-search-form'},
          html('label',{for:'loc-search-input'},'搜尋關鍵詞'),
          html('input',{id:'loc-search-input',name:'q',type:'search',required:true}),
          html('button',{type:'submit'},'搜尋')
        )
      ]:[]),
      html('div',{id:'loc-feature-panel','class':'loc-feature-panel',role:'status'},'')
    );
  return shell(scope,section,body);
}
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
export function documentHTML({scope,section='home',rows=[],description=''}={}){
  const title=section==='home'?SCOPES[scope].label:
    SECTIONS[section]+' · '+SCOPES[scope].label;
  return '<!doctype html><html lang="zh-Hant"><head>'+
    '<meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+
    '<meta name="description" content="'+escape(description)+'">'+
    '<title>'+escape(title)+'</title>'+
    '<link rel="icon" href="/assets/site/icons/loc-favicon.png">'+
    '<link rel="stylesheet" href="/loc-native.css">'+
    '</head><body>'+renderHTML(pageView({scope,section,rows}))+
    (section==='home'?'':'<script type="module" src="/loc-native-client.mjs"></script>')+
    '</body></html>';
}
