// One verified LOC Scope, one existing Kysely transaction, one Trace page Save.
// The caller owns authentication, COMMIT/ROLLBACK, cancellation and DB.close.
// No generic SQL, extra worker, stored RPC, RLS or migration.
import {sql} from 'kysely';
import {allocateLucusUid} from '../model/uid.js';
import {assertZModelLucusBlockManagedValues}
  from '../../../packages/zenstack/import-validation.mjs';
import {scopeTableName} from '../../../packages/zenstack/scope-table-names.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
function fail(message,status=400){
  throw Object.assign(new Error(message),{httpStatus:status});
}
function uniqueUids(input,{allowEmpty=false,max=10000}={}){
  if(!Array.isArray(input)||input.length>max||(!allowEmpty&&!input.length)||
    input.some(uid=>typeof uid!=='string'||!UID.test(uid))||
    new Set(input).size!==input.length)
    fail('Trace UID list is invalid');
  return input;
}
function title(input){
  const value=String(input??'').trim();
  if(!value||value.length>120)fail('Trace Point title must contain 1–120 characters');
  return value;
}
function pointRecord(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>![
      'uid','title','description','address','longitude','latitude','invisible'
    ].includes(k)))fail('Invalid Trace Point update');
  const uid=String(input.uid||'').trim();
  if(uid&&!UID.test(uid))fail('Invalid Trace Point UID');
  const description=String(input.description??'').trim();
  const location=String(input.address??'').trim();
  if(description.length>2000||location.length>320||
    typeof input.invisible!=='boolean')
    fail('Invalid Trace Point attributes');
  const lng=String(input.longitude??'').trim(),lat=String(input.latitude??'').trim();
  if(Boolean(lng)!==Boolean(lat)||
    lng&&(!Number.isFinite(Number(lng))||!Number.isFinite(Number(lat))||
      Math.abs(Number(lng))>180||Math.abs(Number(lat))>90))
    fail('Invalid Trace Point coordinates');
  return {uid,title:title(input.title),description,address:location,
    longitude:lng?Number(lng):null,latitude:lat?Number(lat):null,
    invisible:input.invisible};
}
function modeled(scope,operation,values){
  assertZModelLucusBlockManagedValues('silver.'+scopeTableName(scope,'lucus'),operation,
    operation==='insert'?[values]:values);
}
function jsonb(value){return sql`${JSON.stringify(value)}::jsonb`;}
async function updateUids(trx,relation,scope,ids,values){
  modeled(scope,'update',values);
  let count=0;
  for(let i=0;i<ids.length;i+=500){
    const batch=ids.slice(i,i+500);
    const result=await trx.updateTable(relation).set(values)
      .where('type','=','point').where('uid','in',batch).executeTakeFirst();
    const affected=Number(result?.numUpdatedRows||0);
    if(affected!==batch.length)fail('Trace batch affected-row mismatch',409);
    count+=affected;
  }
  return count;
}

export async function saveTracePageInTransaction(trx,scope,args,mergePoints){
  const relation='silver.'+scopeTableName(scope,'lucus');
  const rawRenames=args.p_renames??[];
  if(!Array.isArray(rawRenames))fail('Invalid Trace rename plans');
  const renames=rawRenames.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||
      Object.keys(row).some(k=>!['uids','title'].includes(k)))
      fail('Invalid Trace rename plan');
    return {uids:uniqueUids(row.uids),title:title(row.title)};
  });
  const renamedUids=renames.flatMap(row=>row.uids);
  if(new Set(renamedUids).size!==renamedUids.length)
    fail('Trace rename UID occurs in multiple plans');
  const point=args.p_point==null?null:pointRecord(args.p_point);
  const keep=String(args.p_keep_uid??point?.uid??'');
  if(keep&&!UID.test(keep))fail('Invalid Trace merge target');
  const removed=uniqueUids(args.p_merge_uids??[],{allowEmpty:true,max:100});
  if(removed.length&&(!keep||removed.includes(keep)))
    fail('Trace merge target and source overlap');
  const rawVisibility=args.p_visibility;
  const visibility=rawVisibility==null?null:{
    uids:uniqueUids(rawVisibility.uids),
    invisible:rawVisibility.invisible
  };
  if(visibility&&(typeof visibility.invisible!=='boolean'||
    visibility.uids.some(uid=>removed.includes(uid))))
    fail('Trace visibility references removed or invalid Points');
  if(!renames.length&&!point&&!removed.length&&!visibility)
    fail('Trace page Save has no changes');

  // All validation precedes the first write. Names are applied before the
  // selected Point; its explicit title therefore wins on the same UID.
  let renamed=0;
  for(const rename of renames)
    renamed+=await updateUids(trx,relation,scope,rename.uids,{title:rename.title});

  let savedUid='',created=false;
  if(point){
    savedUid=point.uid||allocateLucusUid();
    let attrs={};
    if(point.uid){
      const before=await trx.selectFrom(relation).select('attr')
        .where('uid','=',point.uid).where('type','=','point')
        .forUpdate().executeTakeFirst();
      if(!before)fail('Trace Point no longer exists',409);
      attrs={...(before.attr||{})};
    }
    if(point.longitude!=null){
      attrs.longitude=point.longitude;attrs.latitude=point.latitude;
    }else{
      delete attrs.longitude;delete attrs.latitude;
    }
    if(point.address){
      attrs.location=Array.isArray(attrs.location)
        ?[...new Set([...attrs.location,point.address])]:point.address;
    }
    const values={title:point.title,description:point.description,
      invisible:point.invisible,attr:attrs};
    if(point.uid){
      modeled(scope,'update',values);
      const result=await trx.updateTable(relation).set({...values,attr:jsonb(attrs)})
        .where('uid','=',point.uid).where('type','=','point').executeTakeFirst();
      if(Number(result?.numUpdatedRows||0)!==1)
        fail('Trace Point UPDATE did not complete',409);
    }else{
      created=true;
      const row={uid:savedUid,type:'point',...values};
      modeled(scope,'insert',row);
      const inserted=await trx.insertInto(relation).values({...row,attr:jsonb(attrs)})
        .returning('uid').executeTakeFirst();
      if(String(inserted?.uid||'').trim()!==savedUid)
        fail('Trace Point INSERT did not complete',409);
    }
  }

  // The pre-existing route/article/Point merge executes on THIS transaction,
  // not in a separately committed RPC.
  const merged=removed.length?await mergePoints({
    p_scope_id:scope,p_keep_uid:keep,p_remove_uids:removed
  }):0;
  const visible=visibility
    ?await updateUids(trx,relation,scope,visibility.uids,
      {invisible:visibility.invisible}):0;
  return {uid:savedUid||keep||null,created,
    renamed_count:renamed,merged_count:merged,visibility_count:visible};
}
