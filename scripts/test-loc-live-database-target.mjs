import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLiveTarget,runtimeTargetId} from '../app/loc/providers/live-database-target.mjs';

const profiles=[
 ['postgres',5432,'postgres:',''],
 ['mysql',3306,'mysql:',''],
 ['mssql',1433,'mssql:','dbo']
];
for(const [engine,port,protocol,schema] of profiles){
 test(engine+' switches Kysely physical connection at runtime without deployment',()=>{
  const {target,profile}=normalizeLiveTarget('test_one',{
   engine,host:'db.example.net',port,database:'loc',username:'reader',
   password:'demo-only-secret'
  });
  assert.equal(target.engine,engine);
  assert.equal(target.connection_alias,'test_one');
  assert.equal(target.schema_name||'',schema);
  const url=new URL(profile.url);
  assert.equal(url.protocol,protocol);
  assert.equal(url.port,String(port));
  assert.equal(decodeURIComponent(url.password),'demo-only-secret');
  assert.equal(profile.tls,true);
 });
}
test('only signed delegation may select a previously registered database ID',()=>{
 assert.equal(runtimeTargetId({db_target:'my_test'}),'my_test');
 assert.equal(runtimeTargetId({}),null);
 for(const id of ['', '../private','postgres://host','TEST?'])
  assert.throws(()=>runtimeTargetId({db_target:id}));
});
test('reject invalid or browser-derived database connection configurations',()=>{
 assert.throws(()=>normalizeLiveTarget('../private',{engine:'postgres'}));
 assert.throws(()=>normalizeLiveTarget('test',{engine:'sqlite',host:'db.example.net',
  port:5432,database:'loc',username:'reader',password:'x'}));
 assert.throws(()=>normalizeLiveTarget('test',{engine:'mssql',host:'db.example.net',
  port:1433,database:'../other',username:'reader',password:'x'}));
 const valid={engine:'mssql',host:'sql.example.net',
  port:1433,database:'loc',username:'reader',password:'example-only'};
 for(const missing of ['username','password']){
  const broken={...valid};delete broken[missing];
  assert.throws(()=>normalizeLiveTarget('test',broken),/credentials are missing/);
 }
 assert.throws(()=>normalizeLiveTarget('test',{...valid,password:''}),
  /Trusted runtime SQL connection is incomplete/);
});
