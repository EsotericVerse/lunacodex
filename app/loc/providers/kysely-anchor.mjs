import {canManageLoc} from './loc-authorization.mjs';
import {portableRelation,serializePortableJsonFields} from './sql-engine-ports.mjs';
import {sql} from 'npm:kysely@0.29.8';

const scopePattern=/^[a-z][a-z0-9]{0,14}$/;
const uidPattern=/^[A-Za-z0-9]{8}$/;
const publicTypes=new Set(['date','period','era','point','path','trace','image','video','rune','suno']);
const keywordTypes=new Set(['category','class','group','item']);
// Source classification reuses the existing Anchor tree store and operations.
// universe -> galaxy -> domain -> from. Names may repeat across levels.
// Galaxy.site and Galaxy.site_id are unchanged for source matching/import dedupe.
const sourceTypes=new Set(['from','domain','galaxy','universe']);
const allowedFields=new Set(['op','uid','title','description','invisible','data','where',
  'limit','offset','updates','mode','classUid','createtime']);
const anchorTime=value=>{
  if(value===null)return null;
  if(typeof value!=='string'||!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)||
     !/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))
    reject('Anchor createtime must be a full timestamp with timezone');
  return new Date(value).toISOString();
};
function reject(message,status=400){
  const error=new Error(message);error.httpStatus=status;throw error;
}
async function isOwner(trx,scope,role){
  return role==='authenticated'&&await canManageLoc(trx,'scope',scope);
}
function asPositiveInteger(value,fallback,max){
  const number=value===undefined?fallback:Number(value);
  if(!Number.isInteger(number)||number<1||number>max)reject('Invalid Anchor limit');
  return number;
}
function namesFrom(node){
  return Array.isArray(node?.attr?.uid)?node.attr.uid.filter(uid=>uidPattern.test(uid)):[];
}
async function keywordCatalog(trx,scope,anchor,attr,owner){
  await sql`reset role`.execute(trx);
  const config=await trx.selectFrom('silver.'+scope)
    .select(['current_keyword_class_uid','keyword_meta'])
    .where('id','=',scope).executeTakeFirst();
  const classUid=String(attr.classUid||config?.current_keyword_class_uid||'');
  if(!uidPattern.test(classUid))return {};
  if(!owner&&config?.keyword_meta?.class_shares?.[classUid]!==true)return {};
  const base=await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
    .where('uid','=',classUid).where('type','=','class').executeTakeFirst();
  if(!base)return {class_uid:classUid,rows:[]};
  const groups=namesFrom(base).length
    ?await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
      .where('type','=','group').where('uid','in',namesFrom(base)).execute():[];
  const grouped=new Map(groups.map(row=>[row.uid,row]));
  const ordered=namesFrom(base).map(uid=>grouped.get(uid)).filter(Boolean);
  const itemUids=[...new Set(ordered.flatMap(namesFrom))];
  const items=itemUids.length
    ?await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
      .where('type','=','item').where('uid','in',itemUids).execute():[];
  const itemByUid=new Map(items.map(row=>[row.uid,row]));
  const mapped=node=>({uid:node.uid,type:node.type,name:node.title,
    desc:node.type==='item'?'':node.description,
    lists:node.type==='item'?(Array.isArray(node.attr?.keyword)?node.attr.keyword:[]):namesFrom(node),
    uid_lists:[]});
  return {class_uid:classUid,rows:[mapped(base),...ordered.map(mapped),
    ...ordered.flatMap(g=>namesFrom(g).map(uid=>itemByUid.get(uid)).filter(Boolean).map(mapped))]};
}
async function suggestions(trx,scope,type,attr){
  await sql`reset role`.execute(trx);
  if(Object.hasOwn(attr,'uid')||Object.hasOwn(attr,'data')||Object.hasOwn(attr,'where'))
    reject('Invalid suggestion request');
  if(type==='item'){
    const column=await sql`select 1 from information_schema.columns
      where table_schema='silver' and table_name=${scope}
        and column_name='keyword_suggestions' limit 1`.execute(trx);
    if(!column.rows.length)return [];
    const row=await trx.selectFrom('silver.'+scope).select('keyword_suggestions')
      .where('id','=',scope).executeTakeFirst();
    return Array.isArray(row?.keyword_suggestions)?row.keyword_suggestions:[];
  }
  if(type!=='point')reject('Suggestions require Point or Item type');
  const limit=asPositiveInteger(attr.limit,40,500);
  const galaxy=sql.ref('silver.'+scope+'_galaxy');
  const result=await sql`select btrim(location) as name,
    count(*)::integer as article_count from ${galaxy}
    where nullif(btrim(location),'') is not null
    group by btrim(location) order by count(*) desc,btrim(location) asc
    limit ${limit}`.execute(trx);
  return result.rows;
}
async function linkPoints(trx,scope,anchor,attr){
  const updates=attr.updates,mode=attr.mode||'place_id';
  if(Object.hasOwn(attr,'uid')||Object.hasOwn(attr,'data')||!Array.isArray(updates)||
     updates.length<1||updates.length>10000||!['place_id','missing_location'].includes(mode))
    reject('Invalid Point links');
  const seen=new Set();
  for(const update of updates){
    if(!update||typeof update!=='object'||!uidPattern.test(String(update.uid||''))||
       !uidPattern.test(String(update.place_id||''))||seen.has(update.uid)||
       mode==='place_id'&&update.expected_place_id!=null||
       mode==='missing_location'&&update.expected_place_id!=null&&
         update.expected_place_id!==update.place_id)reject('Invalid Point link batch');
    seen.add(update.uid);
  }
  await sql`reset role`.execute(trx);
  const pointIds=[...new Set(updates.map(item=>item.place_id))];
  const points=await trx.selectFrom(anchor).select(['uid','title'])
    .where('type','=','point').where('uid','in',pointIds).execute();
  if(points.length!==pointIds.length||points.some(p=>String(p.title||'').trim().length<1||
      String(p.title||'').trim().length>200))
    reject('Referenced Point is unavailable');
  const values=JSON.stringify(updates);
  const galaxy=sql.ref('silver.'+scope+'_galaxy');
  const point=sql.ref(anchor);
  let result;
  if(mode==='place_id'){
    result=await sql`update ${galaxy} as g set place_id=u.place_id
      from jsonb_to_recordset(${values}::jsonb) as u(uid text,place_id text)
      where g.uid=u.uid and nullif(btrim(g.place_id),'') is null`.execute(trx);
  }else{
    result=await sql`update ${galaxy} as g
      set location=btrim(a.title),
        place_id=coalesce(nullif(btrim(g.place_id),''),u.place_id)
      from jsonb_to_recordset(${values}::jsonb)
        as u(uid text,place_id text,expected_place_id text,manual boolean)
      join ${point} as a on a.uid=u.place_id and a.type='point'
      where g.uid=u.uid
        and nullif(btrim(g.place_id),'') is not distinct from u.expected_place_id
        and (g.location is null or g.location ~ '^[[:space:]　]*$')`.execute(trx);
  }
  const count=Number(result.numAffectedRows||0);
  if(count!==updates.length)reject('Concurrent Point link changes; transaction rolled back',409);
  return {count};
}
export async function executeKyselyAnchor(trx,body,{role='anon'}={}){
  const scope=String(body?.scopeid||'').trim().toLowerCase();
  const type=String(body?.type||'').trim();
  const attr=body?.attr??{};
  if(!scopePattern.test(scope)||!(publicTypes.has(type)||keywordTypes.has(type)||sourceTypes.has(type))||
    !attr||typeof attr!=='object'||Array.isArray(attr)||
    Object.keys(attr).some(field=>!allowedFields.has(field)))
    reject('Invalid Scope/Anchor request');
  const op=String(attr.op||'read');
  // Source node writes must pass the authoritative Scope ownership and
  // UID-link validation in the existing managed-action boundary.
  if(sourceTypes.has(type)&&op!=='read')reject('Use authorized source catalog write',403);
  if(!['read','catalog','suggestions','insert','update','patch','link','delete'].includes(op))
    reject('Invalid Anchor operation');
  const registry=await trx.selectFrom('api.manage')
    .select(['manage_role','active','anchor_table'])
    .where('id','=',scope).executeTakeFirst();
  if(!registry||registry.manage_role!=='scope'||registry.active!==true)
    reject('Unknown or inactive Scope');
  const suffix=String(registry.anchor_table||'anchor');
  if(!/^[a-z][a-z0-9_]*$/.test(suffix))reject('Invalid Anchor relation');
  const anchor='silver.'+scope+'_'+suffix;
  const owner=await isOwner(trx,scope,role);
  if(op==='catalog'){
    if(type!=='class'||attr.uid!==undefined||attr.data!==undefined)
      reject('Invalid Keyword catalog');
    return {data:await keywordCatalog(trx,scope,anchor,attr,owner),count:null};
  }
  const uid=attr.uid===undefined?null:String(attr.uid);
  if(uid!==null&&!uidPattern.test(uid))reject('Invalid Anchor UID');
  if(op==='read'){
    if(!owner&&!publicTypes.has(type))return {data:[],count:null};
    const limit=asPositiveInteger(attr.limit,100,500);
    const offset=attr.offset===undefined?0:Number(attr.offset);
    if(!Number.isInteger(offset)||offset<0||offset>100000)reject('Invalid Anchor offset');
    if(attr.where!==undefined&&(!attr.where||typeof attr.where!=='object'||Array.isArray(attr.where)))
      reject('Invalid JSONB Anchor filter');
    let query=trx.selectFrom(anchor)
      .select(['uid','type','title','description','invisible','attr','createtime'])
      .where('type','=',type);
    if(uid)query=query.where('uid','=',uid);
    if(!owner)query=query.where('invisible','=',false);
    if(attr.where)query=query.where(sql`attr @> ${JSON.stringify(attr.where)}::jsonb`);
    const rows=await query.orderBy('createtime','desc').orderBy('title','asc').limit(limit).offset(offset).execute();
    return {data:rows,count:null};
  }
  if(!owner)reject('Scope management permission required',403);
  if(op==='suggestions'){
    return {data:await suggestions(trx,scope,type,attr),count:null};
  }
  if(op==='link'){
    if(type!=='point')reject('Point links require Point type');
    return {data:await linkPoints(trx,scope,anchor,attr),count:null};
  }
  if(op==='delete')reject('Anchor deletion requires reference-safe dedicated operation');
  if(!uid)reject('Anchor UID required');
  if(attr.data!==undefined&&(!attr.data||typeof attr.data!=='object'||Array.isArray(attr.data)))
    reject('Anchor attr must be a JSON object');
  if(op==='insert'){
    if(attr.data===undefined)reject('Anchor data required');
    const row={uid,type,title:attr.title??null,description:attr.description??null,
      invisible:attr.invisible??false,attr:attr.data,
      ...(Object.hasOwn(attr,'createtime')?{createtime:anchorTime(attr.createtime)}:{})};
    const inserted=await trx.insertInto(anchor).values(row)
      .returning(['uid','type','title','description','invisible','attr','createtime']).executeTakeFirst();
    if(!inserted)reject('Anchor insert failed');
    return {data:inserted,count:null};
  }
  if(op==='patch'&&attr.data===undefined)reject('Anchor patch data required');
  const values={};
  if(Object.hasOwn(attr,'title'))values.title=attr.title;
  if(Object.hasOwn(attr,'description'))values.description=attr.description;
  if(Object.hasOwn(attr,'invisible'))values.invisible=attr.invisible;
  if(Object.hasOwn(attr,'data'))values.attr=op==='patch'
    ?sql`attr || ${JSON.stringify(attr.data)}::jsonb`:attr.data;
  if(!Object.keys(values).length)reject('Empty Anchor update');
  const updated=await trx.updateTable(anchor).set(values)
    .where('uid','=',uid).where('type','=',type)
    .returning(['uid','type','title','description','invisible','attr','createtime']).executeTakeFirst();
  if(!updated)reject('Anchor row not found');
  return {data:updated,count:null};
}

function portableAttr(value){
  if(typeof value==='string'){try{return JSON.parse(value)}catch{return {}}}
  return value&&typeof value==='object'?value:{};
}
const portableRow=row=>row?{...row,attr:portableAttr(row.attr)}:null;
const modified=result=>Number(result?.numUpdatedRows??result?.numAffectedRows??0);
export async function executePortableKyselyAnchor(db,body,{role='anon',engine,namespace=''}={}){
  const scope=String(body?.scopeid||'').trim().toLowerCase();
  const type=String(body?.type||'').trim(),data=body?.attr??{};
  if(!scopePattern.test(scope)||!(publicTypes.has(type)||keywordTypes.has(type)||sourceTypes.has(type))||
     !data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).some(key=>!allowedFields.has(key)))
    reject('Invalid portable Anchor request');
  const op=String(data.op||'read'),uid=data.uid==null?null:String(data.uid);
  if(sourceTypes.has(type)&&op!=='read')reject('Use authorized source catalog write',403);
  if(uid&&!uidPattern.test(uid))reject('Invalid UID');
  const table=portableRelation(scope+'_anchor',engine,namespace);
  const owner=await isOwner(db,scope,role);
  const columns=['uid','type','title','description','invisible','attr','createtime'];
  if(op==='read'){
    if(!owner&&!publicTypes.has(type))return {data:[],count:null};
    const limit=asPositiveInteger(data.limit,100,500);
    const offset=data.offset==null?0:Number(data.offset);
    if(!Number.isInteger(offset)||offset<0||offset>100000)reject('Invalid offset');
    let query=db.selectFrom(table).select(columns).where('type','=',type);
    if(uid)query=query.where('uid','=',uid);
    if(!owner)query=query.where('invisible','=',false);
    if(data.where!==undefined){
      if(!data.where||typeof data.where!=='object'||Array.isArray(data.where))
        reject('Invalid Anchor JSON filter');
      if(engine==='postgres')query=query.where(sql`attr @> ${JSON.stringify(data.where)}::jsonb`);
      else if(engine==='mysql')query=query.where(sql`json_contains(attr, ${JSON.stringify(data.where)})`);
      else for(const [key,value] of Object.entries(data.where)){
        if(!/^[a-z][a-z0-9_]*$/i.test(key)||value!==null&&typeof value==='object')
          reject('Unsupported nested JSON filter');
        query=query.where(sql`json_value(attr, ${'$.'+key})`,
          value===null?'is':'=',value===null?null:String(value));
      }
    }
    return {data:(await query.orderBy('createtime','desc').orderBy('title','asc').limit(limit).offset(offset)
      .execute()).map(portableRow),count:null};
  }
  if(op==='catalog'){
    if(type!=='class'||uid||data.data!==undefined)reject('Invalid catalog');
    if(!owner)return {data:{},count:null};
    const query=db.selectFrom(table).select(columns).where('type','=','class');
    const node=await (data.classUid?query.where('uid','=',String(data.classUid)):
      query.orderBy('title','asc')).executeTakeFirst();
    if(!node)return {data:{},count:null};
    const root=portableRow(node);
    const groups=(namesFrom(root).length?await db.selectFrom(table).select(columns)
      .where('type','=','group').where('uid','in',namesFrom(root)).execute():[]).map(portableRow);
    const ordered=namesFrom(root).map(id=>groups.find(g=>g.uid===id)).filter(Boolean);
    const ids=[...new Set(ordered.flatMap(namesFrom))];
    const items=(ids.length?await db.selectFrom(table).select(columns)
      .where('type','=','item').where('uid','in',ids).execute():[]).map(portableRow);
    const mapped=n=>({uid:n.uid,type:n.type,name:n.title,
      desc:n.type==='item'?'':n.description,lists:n.type==='item'?[]:namesFrom(n),uid_lists:[]});
    return {data:{class_uid:root.uid,rows:[mapped(root),...ordered.map(mapped),
      ...ordered.flatMap(g=>namesFrom(g).map(id=>items.find(x=>x.uid===id))
        .filter(Boolean).map(mapped))]},count:null};
  }
  if(!owner)reject('Scope management permission required',403);
  if(op==='suggestions'){
    if(type==='item')return {data:[],count:null};
    if(type!=='point')reject('Invalid Point suggestions');
    const galaxy=portableRelation(scope+'_galaxy',engine,namespace);
    const rows=await db.selectFrom(galaxy).select('location')
      .select(eb=>eb.fn.countAll().as('article_count'))
      .where('location','is not',null).where('location','!=','')
      .groupBy('location').orderBy('article_count','desc')
      .limit(asPositiveInteger(data.limit,40,500)).execute();
    return {data:rows.map(row=>({name:String(row.location).trim(),
      article_count:Number(row.article_count)})).filter(row=>row.name),count:null};
  }
  if(op==='link'){
    if(type!=='point'||uid||!Array.isArray(data.updates)||!data.updates.length||
       data.updates.length>10000)reject('Invalid Point links');
    const mode=data.mode||'place_id';
    if(!['place_id','missing_location'].includes(mode))reject('Invalid link mode');
    const ids=new Set();
    for(const row of data.updates){
      if(!uidPattern.test(String(row?.uid||''))||
         !uidPattern.test(String(row?.place_id||''))||ids.has(row.uid))
        reject('Invalid Point link UID');
      ids.add(row.uid);
    }
    const points=await db.selectFrom(table).select(['uid','title'])
      .where('type','=','point').where('uid','in',
        [...new Set(data.updates.map(row=>row.place_id))]).execute();
    const names=new Map(points.map(row=>[row.uid,String(row.title||'').trim()]));
    const galaxy=portableRelation(scope+'_galaxy',engine,namespace);
    // One Kysely UPDATE per Point and chunk, not one UPDATE per article.
    // The gateway's transaction makes a partial batch fail atomically.
    const byPoint=new Map();
    for(const row of data.updates){
      if(!names.has(row.place_id))reject('Missing Point');
      if(!byPoint.has(row.place_id))byPoint.set(row.place_id,[]);
      byPoint.get(row.place_id).push(row.uid);
    }
    let count=0;
    for(const [pointId,articleIds] of byPoint){
      for(let index=0;index<articleIds.length;index+=200){
        const chunk=articleIds.slice(index,index+200);
        const values=mode==='place_id'?{place_id:pointId}:
          {place_id:pointId,location:names.get(pointId)};
        let query=db.updateTable(galaxy).set(values)
          .where('uid','in',chunk);
        query=mode==='place_id'
          ?query.where(eb=>eb.or([eb('place_id','is',null),eb('place_id','=','')]))
          :query.where(eb=>eb.or([eb('location','is',null),eb('location','=','')]));
        count+=modified(await query.executeTakeFirst());
      }
    }
    if(count!==data.updates.length)reject('Concurrent Point link changes',409);
    return {data:{count},count:null};
  }
  if(op==='delete')reject('Anchor deletion requires reference-safe operation');
  if(!['insert','update','patch'].includes(op)||!uid)reject('Invalid Anchor operation');
  if(data.data!==undefined&&(!data.data||typeof data.data!=='object'||Array.isArray(data.data)))
    reject('Invalid Anchor data');
  if((op==='insert'||op==='patch')&&data.data===undefined)reject('Anchor data required');
  const current=op==='insert'?null:await db.selectFrom(table).select(columns)
    .where('uid','=',uid).where('type','=',type).executeTakeFirst();
  if(op!=='insert'&&!current)reject('Anchor row missing');
  const changes={};
  for(const key of ['title','description','invisible'])
    if(Object.hasOwn(data,key))changes[key]=data[key];
  if(Object.hasOwn(data,'data'))changes.attr=op==='patch'
    ?{...portableAttr(current.attr),...data.data}:data.data;
  if(op==='insert'){
    await db.insertInto(table).values(serializePortableJsonFields({
      uid,type,title:data.title??null,description:data.description??null,
      invisible:data.invisible??false,attr:data.data,
      ...(Object.hasOwn(data,'createtime')?{createtime:anchorTime(data.createtime)}:{})
    },engine)).execute();
  }else{
    if(!Object.keys(changes).length)reject('Empty update');
    const result=await db.updateTable(table).set(serializePortableJsonFields(changes,engine))
      .where('uid','=',uid).where('type','=',type).executeTakeFirst();
    if(modified(result)!==1)reject('Anchor update incomplete');
  }
  const result=await db.selectFrom(table).select(columns)
    .where('uid','=',uid).where('type','=',type).executeTakeFirst();
  if(!result)reject('Anchor write incomplete');
  return {data:portableRow(result),count:null};
}
