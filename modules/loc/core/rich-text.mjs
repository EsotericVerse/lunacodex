import {html} from './html.mjs';

// Only published prose tags are admitted. HTML input never becomes raw DOM.
const ALLOWED=new Set(['p','h1','h2','h3','h4','h5','h6','strong','em','u','s','b','i','span','div','blockquote','ul','ol','li','br','a','img','code','pre']);
const EMPTY=new Set(['br','img']);
const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
export function decodeText(value=''){
  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,(_,name)=>{
    if(name[0]==='#'){
      const n=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);
      return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\uFFFD';
    }
    return named[name.toLowerCase()]??'&'+name+';';
  });
}
function attr(text,name){
  const re=new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))','i');
  const match=text.match(re);
  return match?decodeText(match[1]??match[2]??match[3]):'';
}
function properties(name,attributes){
  const props={};
  if(name==='a'){
    const href=attr(attributes,'href');
    if(href)props.href=href;
    if(attr(attributes,'target')==='_blank'){
      props.target='_blank';props.rel='noopener noreferrer';
    }
  }
  if(name==='img'){
    const src=attr(attributes,'src');
    if(src)props.src=src;
    props.alt=attr(attributes,'alt');
    props.loading='lazy';
  }
  return props;
}
export function parseRichText(source=''){
  const root={name:null,props:{},children:[]};
  const stack=[root];
  const input=String(source);
  const tokens=input.match(/<[^>]*>|[^<]+|</g)||[];
  for(const token of tokens){
    const match=token.match(/^<\s*(\/?)\s*([a-z][a-z0-9]*)([^>]*)>$/i);
    if(!match){
      stack.at(-1).children.push(decodeText(token));
      continue;
    }
    const name=match[2].toLowerCase();
    if(!ALLOWED.has(name))continue;
    if(match[1]){
      const index=stack.findLastIndex(node=>node.name===name);
      if(index>0)stack.length=index;
      continue;
    }
    const node={name,props:properties(name,match[3]),children:[]};
    stack.at(-1).children.push(node);
    if(!EMPTY.has(name)&&!token.endsWith('/>'))stack.push(node);
  }
  const convert=node=>typeof node==='string'?node:
    html(node.name,node.props,...node.children.map(convert));
  return root.children.map(convert);
}
