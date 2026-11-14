// Contract test: real ZenStack v3 query schema + Zod insert validation
// against an in-memory Kysely transaction simulator for all three dialect
// branches. This does NOT claim a live PostgreSQL/MySQL/MSSQL integration test.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {processShortImport,portableShortImportStore,
  shortImportAppendExpression} from '../app/loc/import/short-append-service.mjs';
import {shortImportLookupPlan,shortImportInsertRows} from '../zenstack/short-import-zk.mjs';

const A='123e4567-e89b-42d3-a456-426614174000';
const B='123e4567-e89b-42d3-a456-426614174001';
const C='123e4567-e89b-42d3-a456-426614174002';
const source='https://chatgpt.com/c/loc-extension-queue';
const now='2026-11-14T08:00:00.000Z';
function event(id,content){
 return {id,group_id:id,source_key:source,url:source,title:'LOC Queue Import',
   content,captured_at:now,kind:'capture',write_mode:'append',
   part_index:0,part_count:1};
}
function batch(id,records){return {id,write_mode:'append',records};}

function simulator(){
 const tables=new Map(),metrics={locks:[],queries:[],inserts:0,appends:0,transactions:0};
 const table=name=>{
  if(!tables.has(name))tables.set(name,[]);
  return tables.get(name);
 };
 function sql(strings,...args){
  const statement=strings.join('?');
  return {statement,args,execute:async()=>{
   if(/get_lock|release_lock|pg_advisory_xact_lock|tablockx/i.test(statement))
    metrics.locks.push(statement);
   if(/get_lock/i.test(statement))return {rows:[{acquired:1}]};
   return {rows:[{locked:1}]};
  }};
 }
 sql.ref=name=>({ref:name});
 function transaction(){
  return {execute:async task=>{
   metrics.transactions++;
   return task(connection());
  }};
 }
 function connection(){
  return {
   selectFrom(name){
    const query={columns:null,filters:[],max:Infinity,locked:false};
    const builder={
     select(value){query.columns=value;return builder},
     where(field,operator,value){query.filters.push({field,operator,value});return builder},
     limit(value){query.max=value;return builder},
     forUpdate(){query.locked=true;return builder},
     async execute(){
      metrics.queries.push({engineTable:name,...query});
      return table(name).filter(row=>query.filters.every(({field,operator,value})=>
       operator==='in'?value.includes(row[field]):operator==='='?row[field]===value:false))
       .slice(0,query.max).map(row=>Object.fromEntries(
        query.columns.map(key=>[key,row[key]])));
     }
    };
    return builder;
   },
   insertInto(name){
    let values;
    return {
     values(v){values=Array.isArray(v)?v:[v];return this},
     async execute(){table(name).push(...values.map(r=>({...r})));metrics.inserts+=values.length;return []},
     async executeTakeFirstOrThrow(){await this.execute();return {}}
    };
   },
   updateTable(name){
    let patch,filters=[];
    return {
     set(value){patch=value;return this},
     where(field,operator,value){filters.push({field,operator,value});return this},
     async executeTakeFirstOrThrow(){
      const found=table(name).filter(row=>filters.every(({field,operator,value})=>
       operator==='in'?value.includes(row[field]):row[field]===value));
      if(found.length!==1)return {numUpdatedRows:found.length};
      found[0].content+=patch.content.args[1];
      found[0].UpdateTime=patch.UpdateTime;
      metrics.appends++;
      return {numUpdatedRows:1};
     }
    };
   },
   transaction
  };
 }
 const db={
  transaction,
  connection(){return {execute:async task=>task({
   ...connection(),transaction
  })};}
 };
 return {db,sql,metrics,tables};
}

for(const engine of ['postgres','mysql','mssql']){
 const {db,sql,metrics,tables}=simulator();
 const appendExpr=shortImportAppendExpression(sql,engine,'content','test-tail');
 assert.equal(appendExpr.args[1],'test-tail');
 assert.equal(appendExpr.statement.includes(' || '),engine==='postgres',
  engine+' only PostgreSQL should use ||');
 assert.equal(appendExpr.statement.includes('concat('),engine!=='postgres',
  engine+' native CONCAT retained');
 const namespace=engine==='postgres'?'silver':engine==='mssql'?'dbo':'';
 const phases=[];
 const store=portableShortImportStore(db,sql,{engine,namespace,
  onPhase:phase=>phases.push(phase)});
 const actor={authorized:true,scopeid:'lo3rwang',subject:'loc_verified_test_user'};
 const uids=['abc12XYZ','abc12XY1','abc12XY2'];
 const uidFactory=()=>uids.shift();
 const importBatch=records=>processShortImport(batch(A,records),actor,{
  store,cryptoProvider:webcrypto,uidFactory
 });
 const first=await importBatch([event(A,'first capture')]);
 assert.equal(first.accepted,true,engine+' accepted');
 assert.equal(first.articles.length,1,engine+' article receipt');
 assert.equal(first.articles[0].appended,1,engine+' append count');
 assert.match(first.articles[0].uid,/^[0-9A-Za-z]{8}$/);
 const duplicate=await importBatch([event(A,'first capture')]);
 assert.equal(duplicate.articles[0].duplicate,true,engine+' retry idempotent');
 const appended=await importBatch([event(B,'second capture')]);
 assert.equal(appended.articles[0].uid,first.articles[0].uid,engine+' original UID stable');
 assert.equal(appended.articles[0].appended,1,engine+' append existing');
 let conflict=false;
 try{await importBatch([event(A,'tampered content')])}catch(e){conflict=e.httpStatus===409}
 assert.equal(conflict,true,engine+' same event ID rejects changed fingerprint');
 const name=(engine==='mysql'?'':namespace+'.')+'lo3rwang_galaxy';
 const rows=tables.get(name)||[];
 assert.equal(rows.length,1,engine+' unique source article');
 assert.equal(metrics.inserts,1,engine+' one INSERT');
 assert.equal(metrics.appends,1,engine+' one UPDATE');
 assert.equal(typeof rows[0].UpdateTime,'string',
  engine+' append must bind timestamp as ISO text');
 assert.match(rows[0].UpdateTime,/^\d{4}-\d{2}-\d{2}T/,
  engine+' append timestamp is ISO 8601');
 assert.equal(rows[0].site,'mcp',engine+' private chat site');
 assert.equal(rows[0].statics,false,engine+' flags remain private');
 assert.equal(rows[0].search,false,engine+' public search disabled');
 assert.equal(metrics.queries.every(q=>q.filters.some(f=>
  f.field==='site_id'&&f.operator==='in')),true,engine+' bounded lookup filter');
 for(const stage of ['mapping','transaction','lock','lookup','insert','append_update','append_result','commit'])
  assert.ok(phases.includes(stage),engine+' import failure stage '+stage);
 const expectedLock=engine==='postgres'?'pg_advisory_xact_lock':
   engine==='mysql'?'get_lock':'tablockx';
 assert.ok(metrics.locks.some(x=>x.includes(expectedLock)),engine+' original lock preserved');
 if(engine==='mysql')
  assert.ok(metrics.locks.some(x=>x.includes('release_lock')),engine+' connection lock released');

 const id='gl:'+'a'.repeat(64);
 const plan=shortImportLookupPlan({scope:'lo3rwang',engine,namespace,ids:[id]});
 assert.deepEqual(plan.columns,['uid','content','site_id']);
 assert.deepEqual(plan.sites,['web','mcp']);
 assert.equal(plan.limit,2);
 assert.throws(()=>shortImportLookupPlan({
  scope:'lo3rwang',engine,namespace,ids:['not a stable source id']
 }),/Invalid|invalid|regex|expected/i);
 assert.throws(()=>shortImportInsertRows({
  scope:'lo3rwang',engine,namespace,rows:[{...rows[0],unauthorized_field:'x'}]
 }),/Invalid|invalid|unrecognized|expected/i);
 console.log('PASS '+engine+' ZModel query + Zod payload + Kysely locks/append/retry/receipts');
}
console.log('PASS Extension Queue SQL portability contract (3 dialect paths; no live DB)');
