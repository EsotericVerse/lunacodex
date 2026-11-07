// Public LOC MCP requests are two fixed, bounded projections, not a SQL API.
// The generic Kysely executor applies publishedOnly once this gate passes.
import {parsePortableOrExpression} from '../providers/portable-search.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const SEARCH_COLUMNS=['uid','title','date','createtime'];
const READ_COLUMNS=['uid','title','content','date','createtime','site','url'];
const FIELDS=new Set(['kind','schema','table','operation','columns','filters',
  'or','orders','limit','offset','target']);
function deny(message){throw Object.assign(new Error(message),{httpStatus:403});}
function same(a,b){return Array.isArray(a)&&a.length===b.length&&
  a.every((item,i)=>item===b[i]);}
function filterEqual(filter,column,value){
  return filter&&Object.keys(filter).length===3&&filter.column===column&&
    filter.operator==='eq'&&filter.value===value;
}
function safeSearch(body){
  if(!same(body.columns,SEARCH_COLUMNS)||body.filters?.length!==1||
    !filterEqual(body.filters[0],'search',true)||!Array.isArray(body.or)||
    body.or.length!==1||typeof body.or[0]!=='string'||body.or[0].length>750)
    return false;
  let expression;
  try{expression=parsePortableOrExpression(body.or[0]);}catch{return false}
  if(expression.type!=='or'||expression.items?.length!==2)return false;
  const [title,content]=expression.items;
  if(title.type!=='predicate'||title.column!=='title'||title.operator!=='contains'||
     content.type!=='predicate'||content.column!=='content'||content.operator!=='contains'||
     title.value!==content.value||title.value.trim().length<2||
     title.value.length>100||/[\u0000-\u001f\u007f]/.test(title.value))return false;
  return Array.isArray(body.orders)&&body.orders.length===2&&
    body.orders[0].column==='date'&&body.orders[0].ascending===false&&
    body.orders[1].column==='createtime'&&body.orders[1].ascending===false&&
    body.orders.every(x=>Object.keys(x).length===2)&&
    Number.isInteger(body.limit)&&body.limit>=1&&body.limit<=20&&
    Number.isInteger(body.offset)&&body.offset>=0&&body.offset<=500;
}
function safeRead(body){
  if(!same(body.columns,READ_COLUMNS)||body.filters?.length!==2||
    !Array.isArray(body.or)&&body.or!==undefined||
    Array.isArray(body.or)&&body.or.length>0||
    !Array.isArray(body.orders)&&body.orders!==undefined||
    Array.isArray(body.orders)&&body.orders.length>0||
    body.limit!==1||body.offset!==0)return false;
  const [uid,visible]=body.filters;
  return uid&&Object.keys(uid).length===3&&uid.column==='uid'&&
    uid.operator==='eq'&&UID.test(String(uid.value||''))&&
    filterEqual(visible,'list',true);
}
export function validatePublicMcpQuery(body,publishedScopes=[]){
  if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).some(key=>!FIELDS.has(key))||
    body.kind!=='query'||body.schema!=='silver'||body.operation!=='select'||
    body.target!=='configured'||!Array.isArray(publishedScopes))
    deny('Unsupported public MCP query');
  const table=String(body.table||'');
  const scope=table.endsWith('_galaxy')?table.slice(0,-7):'';
  if(!SCOPE.test(scope)||!publishedScopes.includes(scope))
    deny('Scope is not published for anonymous MCP access');
  if(!safeSearch(body)&&!safeRead(body))
    deny('Only bounded public search and exact UID read are allowed');
  return body;
}
