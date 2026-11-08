import test from 'node:test';
import assert from 'node:assert/strict';
import {executePortableMcp} from '../app/loc/providers/kysely-mcp.mjs';
const scope='lo3rwang',claims={provider:'loc',me:true,grants:[
 'lo3rwang:read','lo3rwang:manage']};
function capture(){
 const calls=[];
 return {calls,db:{
  selectFrom(name){
   const state={table:name};
   calls.push(state);
   const q={
    select(fields){state.fields=fields;return q},
    where(column,operator,value){(state.predicates||=[]).push({column,operator,value});return q},
    limit(n){state.limit=n;return q},
    orderBy(field,direction){state.order={field,direction};return q},
    async execute(){return [{uid:'legacy-123',title:'mapped',createtime:'2026-11-01'}]}
   };
   return q;
  }
 }};
}
test('authorized physical mapping chooses table and columns without changing schema or code',async()=>{
 const {db,calls}=capture();
 const result=await executePortableMcp(db,{
  kind:'mcp-search',scopeid:scope,user_requested:true,query:'mapped',limit:2
 },claims,{engine:'mysql',namespace:'',tableName:'archive_existing',
  fieldMap:{uid:'external_id',title:'headline',content:'body',
   createtime:'created_at'}});
 assert.equal(result.data.length,1);
 assert.equal(calls[0].table,'archive_existing');
 assert.equal(calls[0].order.field,'created_at');
 const mappedNames=calls[0].fields.map(field=>
  typeof field==='string'?field:JSON.stringify(field.toOperationNode()));
 assert.ok(mappedNames.some(x=>x.includes('headline')&&x.includes('title')));
 assert.ok(mappedNames.some(x=>x.includes('external_id')&&x.includes('uid')));
 assert.equal(calls[0].limit,2);
});
test('mapped SQL rejects normal read-only scopes and all writes',async()=>{
 const {db}=capture();
 const opts={engine:'postgres',namespace:'silver',tableName:'existing_articles'};
 await assert.rejects(executePortableMcp(db,{
  kind:'mcp-read',scopeid:scope,uid:'external',site:'mcp'
 },{...claims,grants:['lo3rwang:read']},opts),/manager/);
 await assert.rejects(executePortableMcp(db,{
  kind:'mcp-sync',scopeid:scope,uid:'external'
 },claims,opts),/manager read/);
});
test('native Galaxy table does not inherit external physical mapping',async()=>{
 const {db,calls}=capture();
 const result=await executePortableMcp(db,{
  kind:'mcp-read',scopeid:scope,uid:'Abc123xy',site:'mcp'
 },claims,{engine:'postgres',namespace:'silver'});
 assert.equal(calls[0].table,'silver.lo3rwang_galaxy');
 assert.equal(result.data.length,1);
});
