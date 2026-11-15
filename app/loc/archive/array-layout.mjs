// Only top-level object fields are eligible as record collection roots.
// Looking for any "data": [ anywhere in the header can accidentally select
// a data[] nested *inside* a Facebook article instead.
export function archiveRootContainers(header){
  const head=String(header||'').replace(/^\uFEFF/,'').trimStart().slice(0,65536);
  let objects=0,arrays=0;
  const fields=[];
  for(let i=0;i<head.length;i++){
    const char=head[i];
    if(char==='"'){
      const start=i;
      let escaped=false,closed=false;
      for(i=i+1;i<head.length;i++){
        if(escaped){escaped=false;continue;}
        if(head[i]==='\\'){escaped=true;continue;}
        if(head[i]==='"'){closed=true;break;}
      }
      if(!closed)break;
      if(objects===1&&arrays===0){
        let j=i+1;
        while(/\s/.test(head[j]||'')&&j<head.length)j++;
        if(head[j]===':'){
          j++;
          while(/\s/.test(head[j]||'')&&j<head.length)j++;
          if(head[j]==='['||head[j]==='{'){
            try{
              const key=JSON.parse(head.slice(start,i+1));
              if(/^[A-Za-z][\w-]*$/.test(key))
                fields.push({key,type:head[j],offset:j});
            }catch{}
          }
        }
      }
      continue;
    }
    if(char==='{')objects++;
    else if(char==='}')objects--;
    else if(char==='[')arrays++;
    else if(char===']')arrays--;
    if(objects<0||arrays<0)break;
  }
  return fields;
}

// Path selection for streamed JSON exports. Meta/Facebook can nest a record
// array inside repeated "array" envelopes. Select the innermost items so
// no full parent array needs to be materialized in memory.
const MAX_ARRAY_ENVELOPES=8;
export function archiveRecordStreamPath(header,base){
  const head=String(header||'').replace(/^\uFEFF/,'').trimStart();
  let path=base==='$'?'$':'$.'+base;
  let offset=0;
  if(base==='$'){
    if(head[0]!=='[')return '$.*';
    path+='.*';offset=1;
  }else{
    const found=archiveRootContainers(head).find(field=>field.key===base);
    if(!found)return path+'.*';
    if(found.type==='['){path+='.*';offset=found.offset+1;}
    else offset=found.offset;
  }
  for(let depth=0;depth<MAX_ARRAY_ENVELOPES;depth++){
    while(/\s/.test(head[offset]||'')&&offset<head.length)offset++;
    if(head[offset]==='['){path+='.*';offset++;continue;}
    if(head[offset]!=='{')break;
    const wrapper=/^\{\s*"array"\s*:\s*([\[{])/.exec(head.slice(offset,offset+512));
    if(!wrapper)break;
    path+='.array';
    offset+=wrapper[0].length-1;
    if(wrapper[1]==='['){path+='.*';offset++;}
  }
  return path;
}

// Only a true array envelope is flattened. Article fields such as media,
// data and attachments are part of the article and must remain untouched.
export function unwrapArchiveArrayRows(payload,{limit=100000}={}){
  const rows=[];
  const stack=[{item:payload,depth:0}];
  while(stack.length){
    const {item,depth}=stack.pop();
    if(depth>MAX_ARRAY_ENVELOPES+2)throw new Error('巢狀陣列超過安全深度');
    if(Array.isArray(item)){
      for(let i=item.length-1;i>=0;i--)stack.push({item:item[i],depth:depth+1});
    }else if(item&&typeof item==='object'&&!Array.isArray(item)
      &&Object.keys(item).length===1&&item.array&&typeof item.array==='object'){
      stack.push({item:item.array,depth:depth+1});
    }else{
      if(!item||typeof item!=='object'||Array.isArray(item))continue;
      rows.push(item);
      if(rows.length>limit)throw new Error('資料列超過匯入上限');
    }
  }
  return rows;
}
