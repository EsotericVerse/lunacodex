// LOC OAuth personal preferences and records. Only a verified LOC session can
// read or change its own owner_id rows; no Admin grant or RLS rule is required.
const TABLES=new Set(['loc_user','user_settings','user_records']);
const COLUMN=/^[A-Za-z_][A-Za-z0-9_]{0,119}$/;
const OPS={eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',
  like:'like',ilike:'ilike',in:'in',is:'is'};
const KEY_COLUMNS={
  loc_user:['owner_id'],
  user_settings:['owner_id','setting_key'],
  user_records:['owner_id','id']
};
function bad(message,status=400){
  return Object.assign(new Error(message),{httpStatus:status});
}
function name(input){
  const text=String(input||'');
  if(!COLUMN.test(text))throw bad('Invalid personal database column');
  return text;
}
function record(value){
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw bad('Invalid personal record');
  const copy={...value};
  // owner_id must be the signed LOC OAuth subject, never caller-controlled.
  delete copy.owner_id;
  if(Object.keys(copy).some(key=>!COLUMN.test(key)))
    throw bad('Invalid personal database field');
  return copy;
}
function apply(query,filters=[]){
  if(!Array.isArray(filters)||filters.length>30)
    throw bad('Invalid personal filters');
  for(const f of filters){
    if(!f||typeof f!=='object'||f.negate||!OPS[f.operator])
      throw bad('Unsupported personal filter');
    const col=name(f.column);
    if(col==='owner_id')throw bad('The owner is bound to LOC OAuth');
    const op=OPS[f.operator];
    if(op==='in'&&(!Array.isArray(f.value)||f.value.length>500))
      throw bad('Invalid personal filter list');
    query=query.where(col,op,f.value);
  }
  return query;
}
function returning(query,columns){
  const cols=Array.isArray(columns)?columns:['*'];
  if(!cols.length||cols.length>50)throw bad('Invalid personal projection');
  if(cols.length===1&&cols[0]==='*')return query.returningAll();
  if(cols.some(col=>typeof col!=='string'||!COLUMN.test(col)))
    throw bad('Invalid personal projection');
  return query.returning(cols);
}
function projection(query,columns){
  const cols=Array.isArray(columns)?columns:['*'];
  if(!cols.length||cols.length>50)throw bad('Invalid personal projection');
  if(cols.length===1&&cols[0]==='*')return query.selectAll();
  if(cols.some(col=>typeof col!=='string'||!COLUMN.test(col)))
    throw bad('Invalid personal projection');
  return query.select(cols);
}
export async function executeLocPersonal(db,claims,body){
  if(claims?.provider!=='loc'||claims?.me!==true||
    !/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(claims.sub||''))||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(claims.email||'')))
    throw bad('Verified LOC OAuth identity required',403);
  const payload=body?.payload||{};
  const table=String(payload.p_table||'');
  if(!table.startsWith('api.')||!TABLES.has(table.slice(4)))
    throw bad('Personal records require an existing personal relation',403);
  const tableKey=table.slice(4);
  const owner=claims.sub;
  const op=String(payload.p_operation||'');
  const filters=payload.p_filters||[];
  const columns=payload.p_columns||['*'];
  const ownerQuery=()=>db.selectFrom(table).where('owner_id','=',owner);
  if(body.kind==='personal-read'){
    if(op!=='select')throw bad('Personal read must be SELECT');
    const head=payload.p_head===true;
    let query=apply(ownerQuery(),filters);
    if(head){
      const result=await query.select(eb=>eb.fn.countAll().as('count')).executeTakeFirst();
      return {data:null,count:Number(result?.count||0)};
    }
    query=projection(query,columns);
    for(const item of payload.p_orders||[]){
      if(!item||typeof item!=='object')throw bad('Invalid personal sorting');
      query=query.orderBy(name(item.column),item.ascending===false?'desc':'asc');
    }
    const limit=payload.p_limit??100;
    const offset=payload.p_offset??0;
    if(!Number.isInteger(limit)||limit<0||limit>5000||
      !Number.isInteger(offset)||offset<0)
      throw bad('Invalid personal pagination');
    const rows=await query.limit(limit).offset(offset).execute();
    return {data:rows,count:null};
  }
  if(body.kind!=='personal-write')throw bad('Unsupported LOC personal operation');
  if(!['insert','upsert','update','delete'].includes(op))
    throw bad('Unsupported personal write');
  if(op==='insert'||op==='upsert'){
    const input=Array.isArray(payload.p_rows)?payload.p_rows:
      payload.p_rows?[payload.p_rows]:[];
    if(!input.length||input.length>500)throw bad('Personal write needs rows');
    const rows=input.map(row=>({...record(row),owner_id:owner}));
    let query=db.insertInto(table).values(rows);
    if(op==='upsert'){
      const keys=KEY_COLUMNS[tableKey];
      const update={...rows[0]};
      delete update.owner_id;
      for(const col of keys)delete update[col];
      query=query.onConflict(oc=>Object.keys(update).length
        ?oc.columns(keys).doUpdateSet(update):oc.columns(keys).doNothing());
    }
    const saved=await returning(query,columns).execute();
    return {data:saved,count:saved.length};
  }
  if(!Array.isArray(filters)||!filters.length)
    throw bad('Personal update/delete requires an existing row filter');
  let query;
  if(op==='update'){
    const values=record(payload.p_values);
    if(!Object.keys(values).length)throw bad('Personal update is empty');
    query=apply(db.updateTable(table).set(values).where('owner_id','=',owner),filters);
  }else{
    query=apply(db.deleteFrom(table).where('owner_id','=',owner),filters);
  }
  const saved=await returning(query,columns).execute();
  return {data:saved,count:saved.length};
}
