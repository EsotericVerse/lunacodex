import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('retired SQLite drivers and their file adapters remain absent',()=>{
  const manifest=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  for(const name of ['sql.js','@capacitor-community/sqlite']){
    assert.equal(manifest.dependencies?.[name],undefined,name);
    assert.equal(lock.packages[''].dependencies?.[name],undefined,name);
    assert.equal(lock.packages['node_modules/'+name],undefined,name);
  }
  for(const path of ['app/loc/providers/local-sqlite.mjs',
    'app/lrunes/local-rune-sqlite.mjs','app/lrunes/RuneSQLiteTransfer.jsx',
    'app/loc/LocalDatabaseImport.jsx'])
    assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
  for(const path of ['app/daily/log/DailyLogClient.jsx','app/lrunes/DailyRuneTransfer.jsx',
    'app/lrunes/RuneAppDayNightDashboard.jsx','app/loc/db-client.mjs'])
    assert.doesNotMatch(read(path),/local-rune-sqlite|createLocalSqliteAdapter/,path);
});
test('SQLite is absent from exposed SQL engine choices',()=>{
  const engine=read('app/loc/providers/sql-engine-ports.mjs');
  const link=read('app/loc/providers/database-link.mjs');
  assert.doesNotMatch(engine,/id:'sqlite'/);
  assert.doesNotMatch(link,/engines:.*'sqlite'/);
});

test('offline Rune records remain browser-local, remote SQL stays explicit',()=>{
  const records=read('app/lrunes/local-rune-records.mjs');
  const client=read('app/loc/db-client.mjs');
  assert.match(records,/indexedDB\.open\(NAME,VERSION\)/);
  assert.match(client,/function unavailableLocal/);
  assert.doesNotMatch(records,/@capacitor-community\/sqlite|sql\.js|from ['"]kysely/);
});


test('Capacitor iOS platform is native-build-only, while used bridges remain runtime dependencies',()=>{
  const manifest=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  const runtime=['@capacitor/core','@capacitor/filesystem','@capacitor/share'];
  assert.equal(manifest.dependencies?.['@capacitor/ios'],undefined);
  assert.equal(manifest.devDependencies?.['@capacitor/ios'],'8.5.3');
  assert.equal(lock.packages[''].dependencies?.['@capacitor/ios'],undefined);
  assert.equal(lock.packages[''].devDependencies?.['@capacitor/ios'],'8.5.3');
  assert.equal(lock.packages['node_modules/@capacitor/ios'].dev,true);
  for(const name of runtime){
    assert.equal(typeof manifest.dependencies?.[name],'string',name+' must be available at runtime');
    assert.equal(lock.packages[''].dependencies?.[name],manifest.dependencies[name]);
    assert.notEqual(lock.packages['node_modules/'+name].dev,true); // production runtime node
  }
  const localFiles=read('app/loc/PrivateLocalFiles.jsx');
  const daily=read('app/lrunes/DailyRuneTransfer.jsx');
  assert.match(localFiles,/import\('@capacitor\/filesystem'\)/);
  assert.match(localFiles,/import\('@capacitor\/share'\)/);
  assert.match(daily,/import\('@capacitor\/filesystem'\)/);
  assert.match(daily,/import\('@capacitor\/share'\)/);
  const iosWorkflow=read('.github/workflows/ios-device-build.yml');
  assert.match(iosWorkflow,/npm ci --no-audit --no-fund/);
  assert.match(iosWorkflow,/"\$RUNNER_TEMP\/loc-capacitor-cli\/node_modules\/\.bin\/cap" add ios/);
});
