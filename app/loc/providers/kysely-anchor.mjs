import {sql} from 'npm:kysely@0.29.8';

const scopePattern=/^[a-z][a-z0-9]{0,14}$/;
const uidPattern=/^[A-Za-z0-9]{8}$/;
const publicTypes=new Set(['date','period','era','point','path','trace','image','video','rune','suno']);
const keywordTypes=new Set(['category','class','group','item']);
const allowedFields=new Set(['op','uid','title','description','invisible','data','where',
  'limit','offset','updates','mode','classUid']);
function reject(message,status=400){
  const error=new Error(message);error.httpStatus=status;throw error;
}
async function isOwner(trx,scope,role){
  if(role!=='authenticated')return false;
  const check=await sql`select coalesce((select allowed from silver.manage('scope',${scope})),false) as allowed`.execute(trx);
  return check.rows[0]?.allowed===true;
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
    desc:node.type==='item'?'':node.description,lists:node.type==='item'?[]:namesFrom(node),
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
  if(!scopePattern.test(scope)||!(publicTypes.has(type)||keywordTypes.has(type))||
    !attr||typeof attr!=='object'||Array.isArray(attr)||
    Object.keys(attr).some(field=>!allowedFields.has(field)))
    reject('Invalid Scope/Anchor request');
  const op=String(attr.op||'read');
  if(!['read','catalog','suggestions','insert','update','patch','link','delete'].includes(op))
    reject('Invalid Anchor operation');
  const registry=await trx.selectFrom('silver.manage')
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
      .select(['uid','type','title','description','invisible','attr'])
      .where('type','=',type);
    if(uid)query=query.where('uid','=',uid);
    if(!owner)query=query.where('invisible','=',false);
    if(attr.where)query=query.where(sql`attr @> ${JSON.stringify(attr.where)}::jsonb`);
    const rows=await query.orderBy('uid','asc').limit(limit).offset(offset).execute();
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
      invisible:attr.invisible??false,attr:attr.data};
    const inserted=await trx.insertInto(anchor).values(row)
      .returning(['uid','type','title','description','invisible','attr']).executeTakeFirst();
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
    .returning(['uid','type','title','description','invisible','attr']).executeTakeFirst();
  if(!updated)reject('Anchor row not found');
  return {data:updated,count:null};
}
