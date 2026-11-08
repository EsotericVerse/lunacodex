// First-party Better Auth persistence, using existing LOC Authority DO storage.
// Uniqueness and hot lookups use KV indexes, NOT full-table scans or SQL DDL.
const PREFIX='loc-better-auth:';
const IDX='loc-better-auth-idx:';
const MODEL=/^[a-z][a-zA-Z0-9]{0,39}$/;
const FIELD=/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_WHERE=24;
const MAX_SCAN=100000;
const txt=new TextEncoder();
function invalid(message){throw new Error(message)}
function prefix(model){
 if(typeof model!=='string'||!MODEL.test(model))invalid('Invalid Better Auth model');
 return PREFIX+model+':';
}
function comparable(value){
 if(value instanceof Date)return value.getTime();
 return value===undefined?null:value;
}
function same(a,b){return comparable(a)===comparable(b)}
function matchesField(row,rule){
 const {field,operator='eq',value}=rule;
 if(!FIELD.test(String(field||'')))invalid('Invalid Better Auth field');
 const lhs=comparable(Object.hasOwn(row,field)?row[field]:null);
 const rhs=comparable(value);
 if(operator==='eq')return same(lhs,rhs);
 if(operator==='ne')return !same(lhs,rhs);
 if(operator==='in')return Array.isArray(value)&&value.some(x=>same(lhs,x));
 if(operator==='not_in')return Array.isArray(value)&&!value.some(x=>same(lhs,x));
 if(operator==='gt')return lhs>rhs;
 if(operator==='gte')return lhs>=rhs;
 if(operator==='lt')return lhs<rhs;
 if(operator==='lte')return lhs<=rhs;
 if(typeof lhs==='string'&&typeof rhs==='string'){
  if(operator==='contains')return lhs.includes(rhs);
  if(operator==='starts_with')return lhs.startsWith(rhs);
  if(operator==='ends_with')return lhs.endsWith(rhs);
 }
 invalid('Unsupported Better Auth filter');
}
function matches(row,where=[]){
 if(!Array.isArray(where)||where.length>MAX_WHERE)invalid('Invalid Better Auth query');
 if(!where.length)return true;
 let passed=null;
 for(const filter of where){
  if(!filter||typeof filter!=='object')invalid('Invalid Better Auth query predicate');
  const next=matchesField(row,filter);
  passed=passed===null?next:(filter.connector==='OR'?passed||next:passed&&next);
 }
 return passed===true;
}
function clean(data){
 if(!data||typeof data!=='object'||Array.isArray(data))invalid('Invalid Better Auth record');
 for(const key of Object.keys(data)){
  if(!FIELD.test(key)||['__proto__','constructor','prototype'].includes(key))
   invalid('Invalid Better Auth record field');
 }
 return {...data};
}
function normalizedEmail(value){return String(value||'').trim().toLowerCase()}
function indices(model,row){
 const result=[];
 if(model==='user'&&typeof row.email==='string'&&row.email)
  result.push(['email',normalizedEmail(row.email)]);
 if(model==='account'&&typeof row.providerId==='string'&&typeof row.accountId==='string')
  result.push(['provider-account',row.providerId+'\0'+row.accountId]);
 if(model==='session'&&typeof row.token==='string'&&row.token)
  result.push(['token',row.token]);
 return result;
}
async function indexKey(model,field,value){
 const digest=await crypto.subtle.digest('SHA-256',txt.encode(value));
 const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return IDX+model+':'+field+':'+hex;
}
async function indexedId(storage,model,where){
 if(!Array.isArray(where)||!where.length||where.some(x=>x.connector==='OR'))
  return null;
 const equal=Object.fromEntries(where.filter(x=>x.operator===undefined||x.operator==='eq')
  .map(x=>[x.field,x.value]));
 if(typeof equal.id==='string')return equal.id;
 const specs=indices(model,equal);
 if(!specs.length)return null;
 const [field,value]=specs[0];
 return await storage.get(await indexKey(model,field,value))||'';
}
async function matchingRows(storage,model,where){
 const key=prefix(model);
 const id=await indexedId(storage,model,where);
 if(id!==null){
  const row=id?await storage.get(key+id):null;
  return row&&matches(row,where)?[[key+id,row]]:[];
 }
 const rows=await storage.list({prefix:key});
 if(rows.size>MAX_SCAN)invalid('Better Auth query exceeds supported bounded scan');
 return [...rows.entries()].filter(([,row])=>matches(row,where));
}
async function ensureFree(storage,model,row,ignoreId=''){
 const key=prefix(model)+row.id;
 if(!ignoreId&&await storage.get(key))invalid('Better Auth record ID exists');
 for(const [field,value] of indices(model,row)){
  const holder=await storage.get(await indexKey(model,field,value));
  if(holder&&holder!==ignoreId){
   if(model==='user')invalid('Account email already registered');
   if(model==='account')invalid('External account already linked');
   invalid('Session token already in use');
  }
 }
}
async function writeIndices(storage,model,row,deleteOnly=false){
 for(const [field,value] of indices(model,row)){
  const key=await indexKey(model,field,value);
  if(deleteOnly){
   if(await storage.get(key)===row.id)await storage.delete(key);
  }else await storage.put(key,row.id);
 }
}
export async function runBetterAuthStore(storage,{
 operation,model,data,where=[],update,limit,offset,sortBy
}={}){
 prefix(model);
 const read=async()=>{
  let rows=(await matchingRows(storage,model,where)).map(([,record])=>record);
  if(sortBy?.field){
   if(!FIELD.test(String(sortBy.field)))invalid('Invalid Better Auth sort field');
   const direction=sortBy.direction==='desc'?-1:1;
   rows.sort((a,b)=>{
    const x=comparable(a[sortBy.field]),y=comparable(b[sortBy.field]);
    return (x===y?0:x==null?-1:y==null?1:x<y?-1:1)*direction;
   });
  }
  return rows;
 };
 if(operation==='findOne')return (await read())[0]||null;
 if(operation==='findMany'){
  const rows=await read();
  const from=Number.isInteger(offset)&&offset>=0?offset:0;
  const size=Number.isInteger(limit)&&limit>=0?Math.min(limit,5000):5000;
  return rows.slice(from,from+size);
 }
 if(operation==='count')return (await read()).length;
 if(operation==='create'){
  const row=clean(data);
  if(typeof row.id!=='string'||!row.id||row.id.length>160)invalid('Missing Better Auth ID');
  return storage.transaction(async tx=>{
   await ensureFree(tx,model,row);
   await tx.put(prefix(model)+row.id,row);
   await writeIndices(tx,model,row);
   return row;
  });
 }
 if(!['update','updateMany','delete','deleteMany'].includes(operation))
  invalid('Unknown Better Auth storage action');
 if(!Array.isArray(where)||!where.length)invalid('Unsafe unbounded Better Auth mutation');
 return storage.transaction(async tx=>{
  const rows=await matchingRows(tx,model,where);
  const many=operation==='updateMany'||operation==='deleteMany';
  const selected=many?rows:rows.slice(0,1);
  if(operation==='update'||operation==='updateMany'){
   const patch=clean(update);
   if(Object.hasOwn(patch,'id'))invalid('Better Auth ID cannot change');
   for(const [key,row] of selected){
    const next={...row,...patch};
    await ensureFree(tx,model,next,row.id);
    await writeIndices(tx,model,row,true);
    await tx.put(key,next);
    await writeIndices(tx,model,next);
   }
   return many?selected.length:selected.length?{...selected[0][1],...patch}:null;
  }
  for(const [key,row] of selected){
   await tx.delete(key);
   await writeIndices(tx,model,row,true);
  }
  return many?selected.length:undefined;
 });
}
