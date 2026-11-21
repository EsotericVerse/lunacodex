// Portable parameterized SELECT and COUNT. Drivers execute compiled statements.
import {assertField} from './model.mjs';
const DIALECTS=new Set(['postgres','mysql','mssql','sqlite']);
function dialectOf(name){
  if(!DIALECTS.has(name))throw new TypeError('Unsupported LOC SQL dialect: '+name);
  return name;
}
function identifier(part,dialect){
  if(dialect==='mysql')return '\u0060'+part+'\u0060';
  if(dialect==='mssql')return '['+part+']';
  return '"'+part+'"';
}
function qualified(name,dialect){
  return name.split('.').map(part=>identifier(part,dialect)).join('.');
}
function compiler(model,dialect){
  dialect=dialectOf(dialect);
  const params=[];
  const bind=value=>{
    params.push(value);
    return dialect==='postgres'?'$'+params.length:
      dialect==='mssql'?'@p'+params.length:'?';
  };
  const col=name=>identifier(assertField(model,name),dialect);
  const predicate=item=>{
    if(!item||typeof item!=='object')throw new TypeError('Invalid LOC SQL predicate');
    if('all' in item||'any' in item){
      const join='all' in item?' AND ':' OR ';
      const items=item.all??item.any;
      if(!Array.isArray(items))throw new TypeError('Invalid LOC SQL predicate group');
      if(!items.length)return 'all' in item?'1=1':'1=0';
      return '('+items.map(predicate).join(join)+')';
    }
    const name=col(item.column);
    const op=item.operator||'eq';
    if(op==='eq'||op==='ne'){
      if(item.value===null)return name+(op==='eq'?' IS NULL':' IS NOT NULL');
      return name+(op==='eq'?' = ':' <> ')+bind(item.value);
    }
    if(op==='in'){
      if(!Array.isArray(item.value))throw new TypeError('LOC IN requires an array');
      if(!item.value.length)return '1=0';
      return name+' IN ('+item.value.map(bind).join(', ')+')';
    }
    const binary={gt:' > ',gte:' >= ',lt:' < ',lte:' <= ',like:' LIKE '};
    if(!Object.hasOwn(binary,op))throw new TypeError('Unsupported LOC SQL operator');
    if(item.value==null)throw new TypeError('LOC SQL predicate value missing');
    return name+binary[op]+bind(item.value);
  };
  return {dialect,params,bind,col,predicate};
}
function validatePaging(limit,offset){
  for(const [name,value] of Object.entries({limit,offset})){
    if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))
      throw new TypeError('LOC SQL '+name+' must be a nonnegative integer');
  }
}
export function compileSelect(model,{
  columns,where=null,orderBy=[],limit,offset=0
}={},dialect='postgres'){
  const c=compiler(model,dialect);
  validatePaging(limit,offset);
  const names=columns===undefined?Object.keys(model.fields):columns;
  if(!Array.isArray(names)||!names.length)throw new TypeError('LOC SQL needs selected columns');
  const selection=names.map(c.col).join(', ');
  const filter=where?' WHERE '+c.predicate(where):'';
  if(!Array.isArray(orderBy))throw new TypeError('Invalid LOC SQL orderBy');
  const order=orderBy.map(item=>{
    const field=typeof item==='string'?item:item?.column;
    const descending=typeof item==='string'?false:item?.descending===true;
    return c.col(field)+(descending?' DESC':' ASC');
  });
  if(c.dialect==='mssql'&&(limit!==undefined||offset>0)&&!order.length)
    order.push(c.col(model.primaryKey)+' ASC');
  let text='SELECT '+selection+' FROM '+qualified(model.table,c.dialect)+filter;
  if(order.length)text+=' ORDER BY '+order.join(', ');
  if(c.dialect==='mssql'){
    if(limit!==undefined||offset>0){
      text+=' OFFSET '+c.bind(offset)+' ROWS';
      if(limit!==undefined)text+=' FETCH NEXT '+c.bind(limit)+' ROWS ONLY';
    }
  }else{
    if(limit!==undefined)text+=' LIMIT '+c.bind(limit);
    if(offset>0)text+=' OFFSET '+c.bind(offset);
  }
  return Object.freeze({text,params:Object.freeze(c.params),dialect:c.dialect});
}
export function compileCount(model,{where=null}={},dialect='postgres'){
  const c=compiler(model,dialect);
  return Object.freeze({
    text:'SELECT COUNT(*) AS '+identifier('total',c.dialect)+' FROM '+
      qualified(model.table,c.dialect)+(where?' WHERE '+c.predicate(where):''),
    params:Object.freeze(c.params),dialect:c.dialect
  });
}


// Writes are explicit, parameterized, and require an actual filter for updates/deletes.
export function compileInsert(model,values,dialect='postgres'){
  const c=compiler(model,dialect);
  if(!values||typeof values!=='object'||Array.isArray(values))
    throw new TypeError('LOC SQL insert values must be an object');
  const fields=Object.keys(values);
  if(!fields.length)throw new TypeError('LOC SQL insert needs values');
  const columns=fields.map(c.col).join(', ');
  const placeholders=fields.map(field=>c.bind(values[field])).join(', ');
  return Object.freeze({
    text:'INSERT INTO '+qualified(model.table,c.dialect)+' ('+columns+') VALUES ('+placeholders+')',
    params:Object.freeze(c.params),dialect:c.dialect
  });
}
function requireFilter(where){
  if(!where||typeof where!=='object')
    throw new TypeError('LOC SQL write requires a WHERE filter');
  const count=item=>{
    if(!item||typeof item!=='object')return 0;
    if('all' in item||'any' in item){
      const items=item.all??item.any;
      if(!Array.isArray(items))return 0;
      return items.reduce((sum,part)=>sum+count(part),0);
    }
    return typeof item.column==='string'?1:0;
  };
  if(count(where)===0)throw new TypeError('LOC SQL write requires a concrete WHERE predicate');
}
export function compileUpdate(model,values,where,dialect='postgres'){
  requireFilter(where);
  const c=compiler(model,dialect);
  if(!values||typeof values!=='object'||Array.isArray(values))
    throw new TypeError('LOC SQL update values must be an object');
  const fields=Object.keys(values);
  if(!fields.length)throw new TypeError('LOC SQL update needs values');
  const assignments=fields.map(field=>c.col(field)+' = '+c.bind(values[field]));
  const filter=c.predicate(where);
  return Object.freeze({
    text:'UPDATE '+qualified(model.table,c.dialect)+' SET '+assignments.join(', ')+' WHERE '+filter,
    params:Object.freeze(c.params),dialect:c.dialect
  });
}
export function compileDelete(model,where,dialect='postgres'){
  requireFilter(where);
  const c=compiler(model,dialect);
  return Object.freeze({
    text:'DELETE FROM '+qualified(model.table,c.dialect)+' WHERE '+c.predicate(where),
    params:Object.freeze(c.params),dialect:c.dialect
  });
}
