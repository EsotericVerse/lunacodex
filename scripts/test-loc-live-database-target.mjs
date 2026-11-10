import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeLiveTarget,runtimeTargetId,registryRelationForEngine} from '../app/loc/providers/live-database-target.mjs';

const profiles=[
 ['postgres',5432,'postgres:','silver'],
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

test('switching a database invalidates browser SQL delegation caches',()=>{
 const ui=readFileSync(new URL('../app/loc/LocDatabaseSwitcher.jsx',import.meta.url),'utf8');
 assert.match(ui,/requestDatabase\('POST','\/v1\/databases\/selection',\{id\}\)/);
 assert.match(ui,/if\(\(result\?\.selected\|\|'configured'\)!==id\)/);
 assert.match(ui,/window\.location\.reload\(\)/);
 // The independent SQL Adapter is recreated on reload, not patched with a
 // browser-selected connection string or stale signed delegation.
 assert.doesNotMatch(ui,/connection_alias\s*:/);
});

test('trusted PostgreSQL TLS and SQL profile changes do not reuse stale pools',()=>{
 const code=readFileSync(new URL('../app/loc/providers/kysely-database-drivers.ts',import.meta.url),'utf8');
 assert.match(code,/profile\.tls===true\?\{ssl:\{rejectUnauthorized:true\}\}/);
 assert.match(code,/profile\.tls===false\?\{ssl:false\}:\{\}/);
 assert.match(code,/JSON\.stringify\(profile\.authentication\|\|\{\}\)/);
 assert.match(code,/String\(profile\.tls\)/);
});

test('passwordless Azure SQL still reaches the trusted driver',()=>{
  const cases=[
    {type:'azure-active-directory-access-token',token:'signed.token'},
    {type:'azure-active-directory-default'},
    {type:'azure-active-directory-msi-vm',clientId:'identity_client'},
    {type:'azure-active-directory-service-principal-secret',
      clientId:'app',tenantId:'tenant',clientSecret:'encrypted-secret'}
  ];
  for(const authentication of cases){
    const {target,profile}=normalizeLiveTarget('azure_live',{
      engine:'mssql',host:'server.database.windows.net',port:1433,
      database:'loc',authentication
    });
    assert.equal(target.engine,'mssql');
    assert.equal(profile.authentication.type,authentication.type);
    const url=new URL(profile.url);
    assert.equal(url.username,'');
    assert.equal(url.password,'');
    assert.equal(profile.tls,true);
  }
  assert.throws(()=>normalizeLiveTarget('azure_live',{
    engine:'postgres',host:'server.database.windows.net',port:5432,
    database:'loc',authentication:{type:'azure-active-directory-default'}
  }),/Unsupported/);
});
test('LOC database editor supplies auth methods without exposing stored secrets',()=>{
 const ui=readFileSync(new URL('../app/loc/LocDatabaseAdmin.jsx',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
 assert.match(ui,/AUTH_METHODS\[form\.engine\]/);
 assert.match(ui,/azure-active-directory-service-principal-secret/);
 assert.match(ui,/client_secret:''/);
 assert.match(ui,/token:''/);
 assert.match(worker,/publicSqlDriverAuthentication\(internalAuth\)/);
 assert.match(worker,/encryptProfile\(profile,this\.env\.LOC_CONTROL_ENCRYPTION_KEY\)/);
});

test('SSO Connection Secret can be rotated without changing the target or Project ID',()=>{
 const ui=readFileSync(new URL('../app/loc/LocDatabaseAdmin.jsx',import.meta.url),'utf8');
 const auth=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
 assert.match(ui,/主動輪替 Connection Secret/);
 assert.match(ui,/Target ID、Project ID、SQL Type、Domain、Port/);
 assert.match(ui,/可單獨輪替；留空則沿用既有值/);
 assert.match(ui,/若疑似外洩，請立即更換並撤銷舊憑證/);
 assert.match(ui,/\.\.\.\(form\.password\?\{password:form\.password\}:\{\}\)/);
 assert.match(auth,/const password=validated\.password\|\|previous\?\.password\|\|''/);
 assert.match(auth,/encrypted:await encryptProfile\(profile,this\.env\.LOC_CONTROL_ENCRYPTION_KEY\)/);
 assert.doesNotMatch(ui,/localStorage\.setItem\([^)]*password/);
});

test('main registry permission relation uses each selected SQL Dialect',()=>{
 assert.equal(registryRelationForEngine('postgres'),'api.manage');
 assert.equal(registryRelationForEngine('mssql'),'api.manage');
 assert.equal(registryRelationForEngine('mysql'),'manage');
 assert.throws(()=>registryRelationForEngine('sqlite'),/Unsupported main SQL engine/);
 const source=readFileSync(new URL('../functions/api/loc-authority-role.js',import.meta.url),'utf8');
 assert.match(source,/registryRelationForEngine\(selected\.engine\)/);
 assert.doesNotMatch(source,/selected\.engine!=='postgres'/);
 const operation=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
 assert.match(operation,/trx\.selectFrom\(registryRelationForEngine\(selected\.engine\)\)/);
});
