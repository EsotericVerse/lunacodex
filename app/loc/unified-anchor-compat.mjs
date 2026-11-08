// Virtual legacy relation names, backed exclusively by <scope>_anchor.
// Resolve physical Anchor cutover from the Scope ID, not a single owner name.
// System/legacy Scopes are excluded until their independent migrations finish.
// No SQL, DDL, table creation, migration or old-data synchronization here.
const legacyName=/^([a-z][a-z0-9]{0,14})_(time|trace|keywords|galaxy_media)$/;
const pendingAnchorScopes=new Set(['loc']);
export const isUnifiedAnchorScope=scopeId=>/^[a-z][a-z0-9]{0,14}$/.test(String(scopeId||''))&&!pendingAnchorScopes.has(String(scopeId));
const physicalColumns=['uid','type','title','description','invisible','attr','createtime','num'];
const legacyKinds={time:'time',trace:'trace',keywords:'keywords',galaxy_media:'media'};
const scopeTypes={
 time:['date','period','era'],trace:['point','path','trace'],
 keywords:['category','class','group','item','pattern'],media:['image','video','rune','suno']
};
const aliases={
 time:{address:'attr',anchor_ids:'attr',range:'attr'},
 trace:{trace_type:'type',anchor_list:'attr',address:'attr',times:'attr',route_list:'attr'},
 keywords:{name:'title',desc:'description',lists:'attr',uid_lists:'attr'},
 galaxy_media:{url:'attr'}
};

const realTypes={anchor:'date',space_anchor:'point','音樂':'suno','播放清單':'suno',runes:'rune'};
const physicalType=value=>realTypes[String(value)]||String(value);
const legacyType=value=>({date:'anchor',point:'space_anchor'})[value]||value;
const labelList=value=>Array.isArray(value)?JSON.stringify(value):value==null?null:
 typeof value==='string'?value:JSON.stringify(value);
const parseLabelList=value=>{
 if(Array.isArray(value))return value;
 if(typeof value!=='string'||!value.trim())return [];
 try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return [];}
};
// Each physical type may store only the fields defined in the unified Anchor contract.
// Lists in attr hold the current eight-character UIDs, not obsolete label links.
const allowedAttr=Object.freeze({
 date:['date'],period:['uid','date'],era:['period','date'],
 point:['longitude','latitude','location','times'],path:['point'],trace:['point','path'],
 category:['uid'],class:['uid'],group:['uid'],item:['keyword','uid','total'],pattern:[],
 image:['url','date'],video:['url','date'],rune:['url','date'],suno:['url','date']
});
const listOf=value=>Array.isArray(value)?value:parseLabelList(value);
function compactAttr(type,value){
 // Dynamic database keys are part of the Pattern posting map. Do not drop
 // them through the legacy fixed-key projection.
 if(type==='pattern'){
   const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
   for(const [dbUid,articles] of Object.entries(input)){
     if(!/^[A-Za-z0-9]{8}$/.test(dbUid)||!Array.isArray(articles)||
       articles.some(uid=>typeof uid!=='string'||!/^[A-Za-z0-9]{8}$/.test(uid))||
       new Set(articles).size!==articles.length)
       throw Error('Pattern postings require db_uid -> unique Galaxy UID array');
   }
   return input;
 }
 const allowed=allowedAttr[type];
 if(!allowed)return {};
 const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 return Object.fromEntries(allowed.filter(key=>input[key]!==undefined&&input[key]!==null)
   .map(key=>[key,input[key]]));
}

const simpleFilters=new Set(['eq','neq','gte','lte','gt','lt','like','ilike','is','in']);
const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
// Four kinds share one case-sensitive UID key. Trace/Media used to depend
// on database-generated UIDs; the unified Anchor table has no such default.
const UID_ALPHABET='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function newAnchorUid(length,assigned){
  const random=globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if(!random)throw Error('Secure UID generator unavailable');
  for(let attempt=0;attempt<128;attempt++){
    const bytes=random(new Uint8Array(length*2));
    let id='';
    for(const byte of bytes){
      if(byte>=248)continue;
      id+=UID_ALPHABET[byte%62];
      if(id.length===length)break;
    }
    if(id.length===length&&!assigned.has(id))return id;
  }
  throw Error('Cannot allocate a unique unified anchor UID');
}
// Every native Anchor writer uses the same case-sensitive Base62 allocator.
export function allocateAnchorUid(assigned=new Set()){
  return newAnchorUid(8,assigned);
}
function prepareAnchorInsert(spec,row,assigned){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw Error('Invalid unified insert row');
  const value={...row},length=8;
  if(value.uid==null||value.uid===''){
    if(spec.kind!=='trace'&&spec.kind!=='media')
      throw Error('Time and Keywords require an allocated UID');
    value.uid=newAnchorUid(length,assigned);
  }
  if(typeof value.uid!=='string'||!new RegExp('^[A-Za-z0-9]{'+length+'}$').test(value.uid))
    throw Error('Invalid unified anchor UID');
  if(assigned.has(value.uid))throw Error('Repeated unified anchor UID in one batch');
  assigned.add(value.uid);
  if(spec.kind==='trace'&&!hasOwn(value,'address'))value.address=null;
  const mapped=toAnchorRow(spec,value);
  return mapped;
}
export function unifiedAnchorSpec(schema,table){
  const matched=String(table||'').match(legacyName);
  if(schema!=='silver'||!matched||!isUnifiedAnchorScope(matched[1]))return null;
  return {table:matched[1]+'_anchor',kind:legacyKinds[matched[2]],legacy:matched[2]};
}
export function toAnchorRow(spec,row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid unified anchor row');
 const data={...row},out={};
 const type=physicalType(data.trace_type||data.type||'');
 if(type)out.type=type;
 if(hasOwn(data,'uid'))out.uid=data.uid;
 if(hasOwn(data,'title'))out.title=data.title;
 if(hasOwn(data,'name'))out.title=data.name;
 if(hasOwn(data,'invisible'))out.invisible=data.invisible;
 // Provenance timestamp is physical, never cultural attr.date.
 if(hasOwn(data,'createtime'))out.createtime=data.createtime;
 if(hasOwn(data,'num'))out.num=data.num;
 if(hasOwn(data,'description'))out.description=
   spec.kind==='trace'&&data.description&&typeof data.description==='object'
     ?JSON.stringify(data.description):data.description;
 if(hasOwn(data,'desc'))out.description=data.desc;
 if(hasOwn(data,'label'))throw Error('Anchor label column was removed; use typed attr fields');
 const attributes={...(data.attr&&typeof data.attr==='object'?data.attr:{})};
 if(spec.kind==='time'){
   if(hasOwn(data,'address')&&(type==='date'||!type))
     attributes.date=data.address==null?null:String(data.address).slice(0,10);
   if(hasOwn(data,'anchor_ids')&&type!=='date')
     attributes[type==='era'?'period':'uid']=listOf(data.anchor_ids);
 }else if(spec.kind==='trace'){
   if(hasOwn(data,'address')&&(type==='point'||!type)){
     const coords=Array.isArray(data.address)?data.address:parseLabelList(data.address);
     if(coords.length===2&&coords.every(x=>Number.isFinite(Number(x)))){
       attributes.longitude=Number(coords[0]);attributes.latitude=Number(coords[1]);
     }else if(typeof data.address==='string'&&data.address.trim()){
       attributes.location=data.address.trim();
     }
   }
   if(hasOwn(data,'anchor_list')&&type!=='point')
     attributes.point=listOf(data.anchor_list);
   if(data.route_list?.routes?.length&&type==='trace')
     attributes.path=data.route_list.routes;
   if(data.route_list?.postal_address&&type==='point')
     attributes.location=String(data.route_list.postal_address);
   if(type==='point'&&Array.isArray(data.times))
     attributes.times=[...new Set(data.times.filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
       .map(value=>new Date(value).toISOString()))].sort();
   // No lossy migration of route segment payloads into unknown keys.
   if(Array.isArray(data.route_list?.segments)&&data.route_list.segments.length)
     throw Error('Trace segments require the explicit unified Anchor contract');
 }else if(spec.kind==='keywords'){
   if(hasOwn(data,'lists'))
     attributes[type==='item'?'keyword':'uid']=listOf(data.lists);

 }else if(spec.kind==='media'){
   if(hasOwn(data,'url'))attributes.url=data.url;
 }
 if(hasOwn(data,'attrs')&&data.attrs&&typeof data.attrs==='object')
   Object.assign(attributes,data.attrs);
 const typed=compactAttr(type,attributes);
 if(Object.keys(typed).length||hasOwn(data,'attr')||
   hasOwn(data,'address')||hasOwn(data,'anchor_ids')||hasOwn(data,'anchor_list')||
   hasOwn(data,'lists')||hasOwn(data,'url')||hasOwn(data,'uid_lists'))
   out.attr=typed;
 for(const key of Object.keys(data)){
   if(['uid','type','trace_type','title','name','invisible','description','desc',
     'address','anchor_ids','range','anchor_list','times','route_list','lists',
     'uid_lists','url','createtime','num','location','attr','attrs'].includes(key))continue;
   throw Error('Unsupported legacy anchor column: '+key);
 }
 return out;
}
export function fromAnchorRow(spec,row){
 if(!row)return row;
 const out={},attr=row.attr||{};
 for(const key of ['uid','title','invisible','description','createtime','num'])
   if(hasOwn(row,key))out[key]=row[key];
 if(hasOwn(row,'type'))out.type=legacyType(row.type);
 if(spec.kind==='time'){
   out.address=row.type==='date'?(attr.date??null):null;
   out.anchor_ids=row.type==='period'?listOf(attr.uid):
     row.type==='era'?listOf(attr.period):[];
   out.range=null;
 }else if(spec.kind==='trace'){
   out.trace_type=legacyType(row.type);
   out.anchor_list=row.type==='point'?[]:listOf(attr.point);
   out.address=row.type==='point'
     ?(Number.isFinite(Number(attr.longitude))&&Number.isFinite(Number(attr.latitude))&&
        attr.longitude!=null&&attr.latitude!=null
         ?[Number(attr.longitude),Number(attr.latitude)]:attr.location??null)
     :null;
   out.times=row.type==='point'&&Array.isArray(attr.times)?attr.times:[];
   out.route_list=attr.path?.length?{routes:attr.path,segments:[]}:{};
   if(typeof out.description==='string'&&out.description.startsWith('{')){
     try{const doc=JSON.parse(out.description);
       if(doc&&typeof doc==='object'&&!Array.isArray(doc))out.description=doc;}catch{}
   }
 }else if(spec.kind==='keywords'){
   out.name=row.title;out.desc=row.description;
   out.lists=listOf(row.type==='item'?attr.keyword:attr.uid);
   // Item linkage is safe for the authorized editor; never project the
   // Pattern database->article UID postings through this browser adapter.
   if(row.type==='item')out.attr={uid:listOf(attr.uid)};
   out.uid_lists=[]; // Article postings live on Pattern Anchors.
 }else if(spec.kind==='media'){
   out.url=attr.url??null;
   out.location=null;
   if(row.type==='suno'&&String(attr.url||'').includes('/playlist/'))out.type='播放清單';
 }
 return out;
}
const readColumn=(spec,name)=>aliases[spec.legacy][name]||name;
function fieldsForSelect(spec,columns){
 if(!columns||columns==='*')return physicalColumns.join(',');
 const fields=new Set(['uid','type']);
 for(const raw of String(columns).split(',')){
   const name=raw.trim().split(':').at(-1).trim(),mapped=readColumn(spec,name);
   // A few old media readers still request these removed fields. They are
   // nullable compatibility projections, not aliases to UID or other data.
   if(spec.kind==='media'&&name==='location')continue;
   if(spec.kind==='time'&&name==='range')continue;
   if(!physicalColumns.includes(mapped))throw Error('Unknown unified anchor column: '+name);
   fields.add(mapped);
 }
 return [...fields].join(',');
}
const applyFilter=(query,filter)=>{
  if(filter.method==='not')return query.not(filter.column,filter.operator,filter.value);
  if(filter.method==='in')return query.in(filter.column,filter.value);
  return query[filter.method](filter.column,filter.value);
};
function evalFilter(row,filter){
  const a=row[filter.column],b=filter.value;
  switch(filter.method){
    case 'eq':return JSON.stringify(a)===JSON.stringify(b);
    case 'neq':return JSON.stringify(a)!==JSON.stringify(b);
    case 'is':return b===null?a==null:a===b;
    case 'in':return (b||[]).includes(a);
    case 'gt':return a>b;
    case 'gte':return a>=b;
    case 'lt':return a<b;
    case 'lte':return a<=b;
    case 'like':case 'ilike':{
      const text=String(a??''),expr=String(b).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');
      return new RegExp('^'+expr+'$',filter.method==='ilike'?'i':'').test(text);
    }
    case 'not':return !evalFilter(row,{...filter,method:filter.operator});
    default:throw Error('Unsupported unified anchor filter: '+filter.method);
  }
}
const normalizeResult=(spec,result,columns,one)=>{
  if(result?.error)return result;
  const project=row=>{
    if(!row)return null;
    const projected=fromAnchorRow(spec,row);
    if(!columns||columns==='*')return projected;
    return Object.fromEntries(String(columns).split(',').map(name=>{
      const [alias,source]=name.includes(':')?name.split(':'):[name,name];
      return [alias.trim(),projected[source.trim()]];
    }));
  };
  if(one){
    const list=Array.isArray(result.data)?result.data:result.data?[result.data]:[];
    return {...result,
      error:one==='single'&&list.length!==1?{message:'Single row expected'}:null,
      data:project(list[0])};
  }
  return {...result,data:Array.isArray(result?.data)?result.data.map(project):result?.data};
};
// One builder implements the subset used by db-query and feature reads/writes.
// Filters, ordering and ranges run on the physical table, with mandatory kind.
// attrs (JSONB legacy fields) are merged on writes, never overwritten blindly.
export function unifiedAnchorRelation(schema,spec){
  return new UnifiedQuery(schema,spec);
}
class UnifiedQuery{
  constructor(schema,spec){
    this.schema=schema;this.spec=spec;this.operation='select';this.fields='*';
    this.filters=[];this.orders=[];this.offset=0;this.maximum=10000;
    this.opts={};this.one='';this.values=null;this.orFilters=[];
    this.abort=null;this.conflict=null;
  }
  select(columns='*',options={}){this.fields=columns;this.opts=options||{};return this}
  insert(rows){this.operation='insert';this.values=rows;return this}
  upsert(rows,options={}){this.operation='upsert';this.values=rows;this.conflict=options;return this}
  update(values){this.operation='update';this.values=values;return this}
  delete(){this.operation='delete';return this}
  eq(column,value){return this.filter(column,'eq',value)}
  neq(column,value){return this.filter(column,'neq',value)}
  gt(column,value){return this.filter(column,'gt',value)}
  gte(column,value){return this.filter(column,'gte',value)}
  lt(column,value){return this.filter(column,'lt',value)}
  lte(column,value){return this.filter(column,'lte',value)}
  is(column,value){return this.filter(column,'is',value)}
  like(column,value){return this.filter(column,'like',value)}
  ilike(column,value){return this.filter(column,'ilike',value)}
  in(column,value){return this.filter(column,'in',value)}
  not(column,operator,value){return this.filter(column,'not',value,operator)}
  filter(column,method,value,operator=''){
    if(!simpleFilters.has(method)&&method!=='not')throw Error('Unsupported anchor filter '+method);
    this.filters.push({column,method,value,operator});return this;
  }
  or(text){this.orFilters.push(String(text));return this}
  order(column,options={}){this.orders.push({column,ascending:options.ascending!==false,nullsFirst:options.nullsFirst});return this}
  range(start,end){this.offset=Math.max(0,Number(start)||0);this.maximum=Math.max(0,Number(end)-this.offset+1);return this}
  limit(value){this.maximum=Math.max(0,Number(value)||0);return this}
  single(){this.one='single';return this}
  maybeSingle(){this.one='maybeSingle';return this}
  abortSignal(value){this.abort=value;return this}
  throwOnError(){this.throwErrors=true;return this}
  returns(){return this}
  then(resolve,reject){return this.run().then(resolve,reject)}
  catch(reject){return this.run().catch(reject)}
  finally(fn){return this.run().finally(fn)}
  build(physical,includeRange=true){
    const spec=this.spec;
    const jsonFilters=[];
    for(const filter of this.filters){
      const mapped=readColumn(spec,filter.column);
      if(mapped==='attr'){jsonFilters.push(filter);continue}
      // A timestamp filter cannot be silently converted into a UID filter.
      if(spec.kind==='media'&&filter.column==='location')
        throw Error('Media '+filter.column+' filtering requires article Galaxy.date/media_link');
      if(!physicalColumns.includes(mapped))throw Error('Unmapped anchor filter: '+filter.column);
      physical=applyFilter(physical,{...filter,column:mapped,
        value:mapped==='type'&&filter.method==='in'?(filter.value||[]).map(physicalType):
          mapped==='type'&&typeof filter.value==='string'?physicalType(filter.value):filter.value});
    }
    // The physical kind predicate cannot be overridden by caller-controlled
    // filters, including OR expressions.
    physical=physical.in('type',scopeTypes[spec.kind]);
    for(const expression of this.orFilters){
      if(/\b(address|times|route_list|uid_lists|range)\b/.test(expression))
        throw Error('JSONB OR filters require a native unified query');
      const rewritten=expression.replace(/([a-z][a-z0-9_]*)(?=\.)/gi,(column)=>
        readColumn(spec,column));
      physical=physical.or(rewritten);
    }
    for(const order of this.orders){
      // Media creation time is a real physical column, not attr.date or UID.
      const mapped=readColumn(spec,order.column);
      if(mapped==='attr')throw Error('JSONB sort requires a native unified query');
      physical=physical.order(mapped,{ascending:order.ascending,nullsFirst:order.nullsFirst});
    }
    // Legacy HTTP query builders support abortSignal; KyselyEdge builders do not.
    // Their fetch already has its own bounded timeout. Never call an absent method.
    if(this.abort&&typeof physical.abortSignal==='function')physical=physical.abortSignal(this.abort);
    if(includeRange)physical=physical.range(this.offset,this.offset+Math.max(1,this.maximum)-1);
    return {physical,jsonFilters};
  }
  async run(){
    const spec=this.spec;
    if(this.operation==='select'){
      let selected=fieldsForSelect(spec,this.fields);
      if(this.filters.some(f=>readColumn(spec,f.column)==='attr')&&!selected.split(',').includes('attr'))
        selected+=',attr';
      const head=this.opts?.head===true;
      let query=this.schema.from(spec.table).select(selected,{
        count:this.opts.count,head:head&&!this.filters.some(f=>readColumn(spec,f.column)==='attr')
      });
      const {physical,jsonFilters}=this.build(query,false);
      if(!jsonFilters.length){
        const result=await physical.range(this.offset,this.offset+Math.max(1,this.maximum)-1);
        return normalizeResult(spec,result,this.fields,this.one);
      }
      // Small legacy JSONB projections are filtered locally until the
      // Kysely SQL gateway accepts indexed JSON path predicates.
      // Bound each scan and fail rather than silently truncate matches.
      const rows=[],size=1000,cap=10000;
      for(let start=0;start<cap;start+=size){
        const page=await physical.range(start,start+size-1);
        if(page.error)return page;
        rows.push(...(page.data||[]));
        if((page.data||[]).length<size)break;
        if(start+size===cap)throw Error('Unified anchor JSON filter exceeded bounded scan');
      }
      let filtered=rows.map(r=>fromAnchorRow(spec,r)).filter(row=>jsonFilters.every(f=>evalFilter(row,f)));
      // Preserve caller's requested offset even when JSON filtering.
      const count=filtered.length;
      filtered=filtered.slice(this.offset,this.offset+this.maximum).map(row=>
        this.fields==='*'?row:Object.fromEntries(String(this.fields).split(',').map(key=>[key.trim(),row[key.trim()]])));
      return {data:this.one?(filtered[0]||null):head?null:filtered,
        error:this.one==='single'&&filtered.length!==1?{message:'Single row not found'}:null,
        count:this.opts.count?count:null};
    }
    if(this.operation==='insert'||this.operation==='upsert'){
      const rows=Array.isArray(this.values)?this.values:[this.values];
      if(!rows.length)throw Error('Empty unified anchor insert');
      const auto=rows.some(row=>row?.uid==null||row.uid==='');
      if(this.operation==='upsert'&&auto)
        throw Error('Unified anchor upsert requires an explicit UID');
      const options=this.operation==='upsert'?{...this.conflict,onConflict:'uid'}:undefined;
      for(let attempt=0;attempt<(auto?4:1);attempt++){
        const assigned=new Set();
        const mapped=rows.map(row=>prepareAnchorInsert(spec,row,assigned));
        let q=this.operation==='upsert'?this.schema.from(spec.table).upsert(mapped,options):
          this.schema.from(spec.table).insert(mapped);
        if(this.fields!=='*')q=q.select(fieldsForSelect(spec,this.fields));
        const result=await q;
        if(result.error?.code==='23505'&&auto&&attempt<3)continue;
        return normalizeResult(spec,result,this.fields);
      }
    }
    if(this.operation==='update'){
      if(!this.filters.length&&!this.orFilters.length)throw Error('Unsafe unified anchor update');
      // All updates of JSONB-backed fields are read/merged per UID so they
      // never erase unrelated attributes. Bulk unfiltered mutation is denied.
      const attrs=Object.keys(this.values||{}).some(key=>readColumn(spec,key)==='attr');
      if(attrs){
        const uid=this.filters.find(f=>f.column==='uid'&&f.method==='eq')?.value;
        if(!uid||this.orFilters.length)throw Error('Unified JSONB updates require exact UID');
        const read=await this.schema.from(spec.table).select('uid,type,attr').eq('uid',uid).in('type',scopeTypes[spec.kind]).maybeSingle();
        if(read.error)return read;
        if(!read.data)return {data:[],error:null,count:0};
        const mapped=toAnchorRow(spec,{type:read.data.type,...this.values});
        // attr is the single source of typed content. Merge partial edits
        // without losing existing UID relationships, dates, or media URLs.
        const merged={...(read.data.attr||{}),...(mapped.attr||{})};
        if(spec.kind==='trace'){
          if(hasOwn(this.values,'address')&&this.values.address==null){
            delete merged.longitude;delete merged.latitude;delete merged.location;
          }
          if(hasOwn(this.values,'anchor_list')&&!this.values.anchor_list?.length)
            delete merged.point;
          if(hasOwn(this.values,'route_list')&&!this.values.route_list?.routes?.length)
            delete merged.path;
        }
        if(spec.kind==='media'&&hasOwn(this.values,'url')&&!this.values.url)
          delete merged.url;
        if(hasOwn(mapped,'attr')||Object.keys(merged).length)
          mapped.attr=compactAttr(read.data.type,merged);
        let q=this.schema.from(spec.table).update(mapped);
        const {physical}=this.build(q,false);
        const res=await physical.select(fieldsForSelect(spec,this.fields));
        return normalizeResult(spec,res,this.fields);
      }
      let q=this.schema.from(spec.table).update(toAnchorRow(spec,this.values));
      const {physical}=this.build(q,false);
      const res=await physical.select(fieldsForSelect(spec,this.fields));
      return normalizeResult(spec,res,this.fields);
    }
    if(this.operation==='delete'){
      if(!this.filters.length&&!this.orFilters.length)throw Error('Unsafe unified anchor delete');
      const q=this.schema.from(spec.table).delete();
      const {physical}=this.build(q,false);
      const res=await physical.select(fieldsForSelect(spec,this.fields));
      return normalizeResult(spec,res,this.fields);
    }
  }
}
