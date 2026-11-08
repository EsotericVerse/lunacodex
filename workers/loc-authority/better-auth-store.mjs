// Better Auth's dedicated, schema-free persistence inside the existing LOC Authority DO.
// No user SQL tables, migrations, or tenant database writes are performed.
const PREFIX='loc-better-auth:';
const MODEL=/^[a-z][a-zA-Z0-9]{0,39}$/;
const FIELD=/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_WHERE=24;
const MAX_RECORDS=10000;
function invalid(message){throw new Error(message);}
function validate(model){
 if(typeof model!=='string'||!MODEL.test(model))invalid('Invalid Better Auth model');
 return PREFIX+model+':';
}
function comparable(value){
 if(value instanceof Date)return value.getTime();
 if(value===undefined)return null;
 return value;
}
function same(a,b){return comparable(a)===comparable(b);}
function matchesField(row,rule){
 const {field,operator='eq',value}=rule;
 if(!FIELD.test(String(field||'')))invalid('Invalid Better Auth field');
 const own=Object.hasOwn(row,field)?row[field]:null;
 const lhs=comparable(own);
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
async function matchingRows(storage,model,where){
 const rows=await storage.list({prefix:validate(model)});
 if(rows.size>MAX_RECORDS)invalid('Better Auth storage capacity exceeded');
 return [...rows.entries()].filter(([,value])=>matches(value,where));
}
async function unique(storage,model,data){
 const rows=await matchingRows(storage,model,[]);
 const has=(field,value)=>rows.some(([,row])=>same(row[field],value));
 if(model==='user'&&typeof data.email==='string'&&rows.some(([,row])=>
  String(row.email||'').toLowerCase()===data.email.toLowerCase()))
  invalid('Account email already registered');
 if(model==='account'&&rows.some(([,row])=>
  row.providerId===data.providerId&&row.accountId===data.accountId))
  invalid('External account already linked');
 if(model==='session'&&has('token',data.token))invalid('Session token already in use');
 if(rows.some(([,row])=>same(row.id,data.id)))invalid('Better Auth record ID exists');
}
export async function runBetterAuthStore(storage,{operation,model,data,where=[],update,limit,offset,sortBy}={}){
 validate(model);
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
   await unique(tx,model,row);
   await tx.put(validate(model)+row.id,row);
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
   for(const [key,row] of selected)await tx.put(key,{...row,...patch});
   return many?selected.length:selected.length?{...selected[0][1],...patch}:null;
  }
  for(const [key] of selected)await tx.delete(key);
  return many?selected.length:undefined;
 });
}
