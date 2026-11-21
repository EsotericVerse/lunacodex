// LOC's HTML contract uses the platform DOM. No JSX, virtual DOM or framework runtime.
const TAG=/^[a-z][a-z0-9-]*$/i;
const ATTRIBUTE=/^[a-z_][a-z0-9_.:-]*$/i;
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const BLOCKED=new Set(['script','style','iframe','object','embed','base','link','meta']);
const URL_ATTRIBUTES=new Set(['href','src','action','formaction','poster','xlink:href']);
const escapeText=value=>String(value).replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);

function elementName(name){
  if(typeof name!=='string'||!TAG.test(name)||BLOCKED.has(name.toLowerCase()))
    throw new TypeError('Invalid LOC HTML element');
  return name.toLowerCase();
}
function attributeName(key){
  const name=key==='className'?'class':key==='htmlFor'?'for':key;
  if(!ATTRIBUTE.test(name)||name==='style'||name==='innerHTML'||name.startsWith('on'))
    throw new TypeError('Invalid LOC HTML attribute: '+key);
  return name;
}
function attributeValue(name,value){
  if(URL_ATTRIBUTES.has(name)){
    const compact=String(value).replace(/[\u0000-\u0020\u007f]+/g,'').toLowerCase();
    if(/^[a-z][a-z0-9+.-]*:/.test(compact)&&
      !/^(https?:|mailto:|tel:)/.test(compact))
      throw new TypeError('Unsafe LOC URL');
  }
  return String(value);
}
function eventName(key){
  return /^on[A-Z][a-zA-Z]*$/.test(key)?key.slice(2).toLowerCase():null;
}
function eachAttribute(props,callback,allowEvents=false){
  for(const [key,value] of Object.entries(props)){
    if(value==null||value===false||key==='key')continue;
    const event=eventName(key);
    if(event){
      if(typeof value!=='function')throw new TypeError('LOC event handler must be a function');
      if(allowEvents)callback(null,value,event);
      continue;
    }
    const name=attributeName(key);
    if(typeof value==='function'||typeof value==='object')
      throw new TypeError('LOC attribute must be scalar: '+name);
    callback(name,attributeValue(name,value),null,value===true);
  }
}
export function html(tag,props={},...children){
  const name=elementName(tag);
  if(!props||typeof props!=='object'||Array.isArray(props))
    throw new TypeError('LOC element properties must be an object');
  if(VOID.has(name)&&children.some(value=>value!=null&&value!==false))
    throw new TypeError('Void HTML element cannot have children');
  return Object.freeze({tag:name,props:Object.freeze({...props}),children:Object.freeze(children.flat(Infinity))});
}
function isNode(value){
  return value&&typeof value==='object'&&typeof value.tag==='string'&&Array.isArray(value.children);
}
export function renderHTML(view){
  if(view==null||typeof view==='boolean')return '';
  if(Array.isArray(view))return view.map(renderHTML).join('');
  if(!isNode(view)) {
    if(['string','number','bigint'].includes(typeof view))return escapeText(view);
    throw new TypeError('LOC HTML received an invalid view');
  }
  const name=elementName(view.tag);
  let attrs='';
  eachAttribute(view.props,(key,value,event,flag)=>{
    if(key)attrs+=' '+key+(flag?'':'="'+escapeText(value)+'"');
  });
  if(VOID.has(name))return '<'+name+attrs+'>';
  return '<'+name+attrs+'>'+view.children.map(renderHTML).join('')+'</'+name+'>';
}
function createDOM(view,doc){
  if(Array.isArray(view)){
    const fragment=doc.createDocumentFragment();
    for(const child of view)fragment.appendChild(createDOM(child,doc));
    return fragment;
  }
  if(view==null||typeof view==='boolean')return doc.createTextNode('');
  if(!isNode(view)){
    if(['string','number','bigint'].includes(typeof view))return doc.createTextNode(String(view));
    throw new TypeError('LOC DOM received an invalid view');
  }
  const name=elementName(view.tag);
  const element=doc.createElement(name);
  eachAttribute(view.props,(key,value,event,flag)=>{
    if(event)element.addEventListener(event,value);
    else if(key)element.setAttribute(key,flag?'':value);
  },true);
  if(VOID.has(name)&&view.children.length)throw new TypeError('Void element children');
  for(const child of view.children)element.appendChild(createDOM(child,doc));
  return element;
}
export function mountHTML(root,view){
  if(!root?.ownerDocument||typeof root.replaceChildren!=='function')
    throw new TypeError('LOC mount requires a DOM container');
  root.replaceChildren(createDOM(view,root.ownerDocument));
  return ()=>root.replaceChildren();
}
