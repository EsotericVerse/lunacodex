// Feature code calls its own Server Action for reads. This adapter rejects
// generic SELECTs and carries only fixed, permission-checked writes.

const IDENT=/^[A-Za-z_][A-Za-z0-9_]*$/;
const FIELD=value=>{
  const field=String(value||'');
  if(!IDENT.test(field))throw Error('Invalid LOC SQL field');
  return field;
};
function noWrite(){throw Error('Public Kysely reader is read only');}
class Query {
  constructor(read,schema,table,mutate=null){
    this.read=read;this.mutate=mutate;
    this.schema=FIELD(schema);this.table=FIELD(table);
    this.operation='select';this.values=null;this.conflict=null;
    this.columns=['*'];this.filters=[];this.orFilters=[];this.orders=[];
    this.offset=0;this.rowLimit=null;this.count=null;
    this.head=false;this.cardinality=null;this.signal=null;this.dbId='';
    this.returning=false;
  }
  select(fields='*',options={}){
    this.returning=true;
    this.columns=String(fields||'*').split(',').map(s=>s.trim()).filter(Boolean);
    // SQL projection alone has no implicit row-count ceiling.
    this.count=options.count||null;this.head=options.head===true;return this;
  }
  _filter(column,op,value,negate=false){
    this.filters.push({column:FIELD(column),op,value,negate});return this;
  }
  eq(c,v){return this._filter(c,'eq',v)}
  neq(c,v){return this._filter(c,'neq',v)}
  gt(c,v){return this._filter(c,'gt',v)}
  gte(c,v){return this._filter(c,'gte',v)}
  lt(c,v){return this._filter(c,'lt',v)}
  lte(c,v){return this._filter(c,'lte',v)}
  like(c,v){return this._filter(c,'like',v)}
  ilike(c,v){return this._filter(c,'ilike',v)}
  // Case-folded *equality*, never a SQL LIKE wildcard expression.
  ieq(c,v){return this._filter(c,'ieq',v)}
  is(c,v){return this._filter(c,'is',v)}
  in(c,v){return this._filter(c,'in',v)}
  contains(c,v){return this._filter(c,'contains',v)}
  not(c,op,v){return this._filter(c,op,v,true)}
  or(value){this.orFilters.push(String(value));return this}
  order(c,{ascending=true,nullsFirst}={}){
    this.orders.push({column:FIELD(c),ascending:Boolean(ascending),nullsFirst});return this;
  }
  limit(n){
    if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid LOC read limit');
    this.rowLimit=n;return this;
  }
  range(start,end){
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)
      throw Error('Invalid LOC read range');
    this.offset=start;return this.limit(end-start+1);
  }
  single(){this.cardinality='single';return this}
  maybeSingle(){this.cardinality='maybeSingle';return this}
  expectDatabase(id){this.dbId=String(id||'');return this}
  abortSignal(signal){this.signal=signal;return this}
  insert(rows){if(!this.mutate)return noWrite();this.operation='insert';this.values=rows;return this}
  update(values){if(!this.mutate)return noWrite();this.operation='update';this.values=values;return this}
  upsert(rows,options={}){if(!this.mutate)return noWrite();this.operation='upsert';this.values=rows;this.conflict=options;return this}
  delete(){if(!this.mutate)return noWrite();this.operation='delete';return this}
  then(ok,fail){return (this.operation==='select'?this.read(this):this.mutate(this)).then(ok,fail)}
}
export function createKyselyPublicClient({
  role='anon',fetch:fetchImpl=globalThis.fetch,mutate=null
}={}){
  if(typeof fetchImpl!=='function')throw Error('LOC Kysely fetch is unavailable');
  async function read(){
    throw Error('LOC database reads must use their feature query action');
  }
  async function write(q){
    if(role!=='authenticated'||!mutate)throw Error('LOC management grant required');
    if(['update','delete'].includes(q.operation)&&!q.filters.length)
      throw Error('Unfiltered LOC write denied');
    const rows=Array.isArray(q.values)?q.values:q.values?[q.values]:[];
    const payload={p_table:q.schema+'.'+q.table,p_operation:q.operation,
      p_rows:['insert','upsert'].includes(q.operation)?rows:null,
      p_values:q.operation==='update'?q.values:null,
      p_filters:q.filters.map(f=>({column:f.column,operator:f.op,value:f.value}))};
    const result=await mutate(payload);
    if(result?.error)throw Error(result.error.message||'LOC Kysely write failed');
    const count=Number(result?.data?.count??result?.count??0);
    if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid LOC write receipt');
    if(!q.returning||!count)return {data:[],error:null,count};
    if(q.operation==='insert')return {data:rows,error:null,count};
    const uidFilter=q.filters.find(filter=>filter.column==='uid'&&
      ['eq','in'].includes(filter.op));
    const ids=uidFilter?(uidFilter.op==='in'?uidFilter.value:[uidFilter.value]):[];
    const data=q.operation==='delete'?ids.map(uid=>({uid})):
      ids.map(uid=>({uid,...(q.values||{})}));
    return {data,error:null,count};
  }
  return {
    role,
    schema(schema){
      FIELD(schema);
      return {from(table){return new Query(read,schema,table,mutate?write:null)},
      managedWrite:noWrite,managedAction:noWrite,
      anchor:noWrite};
    },
    shortImport:noWrite,
    activeTarget:async()=>({data:{id:'primary'},error:null})
  };
}
