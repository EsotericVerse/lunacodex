import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {publicNumericSources} from '../app/api/loc/_server.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Portable public SQL backup is optional and does not require a vendor Auth service',async()=>{
  const noBackup=publicNumericSources({primaryGatewayUrl:'https://main.example.org/v1/sql',backupGatewayUrl:''});
  assert.deepEqual(noBackup.map(x=>x.id),['primary']);
  const requests=[];
  const sources=publicNumericSources({
    primaryGatewayUrl:'https://main.example.org/v1/sql',
    backupGatewayUrl:'https://backup.example.org/v1/query',
    fetchImpl:async(url,init)=>{
      requests.push({url:String(url),init});
      return Response.json({data:[{uid:'aB12cD34'}]});
    }
  });
  assert.deepEqual(sources.map(x=>x.id),['primary','backup']);
  const {data,error}=await sources[1].schema().from('lo3rwang_galaxy')
    .select('uid').eq('uid','aB12cD34').limit(1);
  assert.ifError(error);
  assert.equal(data[0].uid,'aB12cD34');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://backup.example.org/v1/query');
  assert.equal(requests[0].init.headers.authorization,undefined);
  assert.equal(requests[0].init.headers.apikey,undefined);
  assert.equal(JSON.parse(requests[0].init.body).target,'configured');
  assert.equal(requests[0].init.credentials,'omit');
});

test('Backup SQL Gateway must be secure and independent of the primary host',()=>{
  assert.throws(()=>publicNumericSources({primaryGatewayUrl:'https://main.example.org/v1/sql',backupGatewayUrl:'http://backup.example.org/v1/query'}),/HTTPS/);
  assert.throws(()=>publicNumericSources({primaryGatewayUrl:'https://main.example.org/v1/sql',backupGatewayUrl:'https://user:password@backup.example.org/v1/query'}),/HTTPS/);
  const server=read('app/api/loc/_server.js');
  assert.doesNotMatch(server,/createBackupPublicAdapter|postgrest-js|token\/anonymous/);
  assert.match(server,/LOC_BACKUP_SQL_GATEWAY_URL/);
  assert.match(server,/createKyselyEdgeClient/);
});
