import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('app/loc/scope-data.js');

function publicBlockReaders({live,readRows,published}){
  const begin=source.indexOf('export async function pageBlocks(');
  const end=source.indexOf('export async function selectScopeBlocks(',begin);
  assert.ok(begin>=0&&end>begin,'Home and Hero Blocks readers must exist');
  const definitions=source.slice(begin,end).replace(/^export /gm,'');
  return new Function('SCOPE_ID_PATTERN','selectLiveScopeBlocks','selectRows',
    'loadPublishedBlocks','BLOCK_COLUMNS','DB_QUERY_BATCH_SIZE',
    definitions+';return {pageBlocks,heroBlocks};')(
      /^[a-z][a-z0-9]{0,14}$/,live,readRows,published,
      'uid,page_name,block_order,block_title,block_text',100
    );
}

test('home index reads the real Scope Blocks table, not unsupported publicAction',async()=>{
  const requests=[];
  const {pageBlocks}=publicBlockReaders({
    live:async(id,page)=>{requests.push([id,page]);return [{uid:'abcdefgh',page_name:page,block_order:1}];},
    readRows:async()=>{throw Error('Hero reader should not run');},
    published:async()=>{throw Error('Publication is not a live database read');}
  });
  const result=await pageBlocks('loc','home');
  assert.deepEqual(requests,[['loc','index']]);
  assert.equal(result[0].uid,'abcdefgh');
  assert.deepEqual(await pageBlocks('INVALID','index'),[]);
});

test('Feature Hero performs one bounded live SELECT for both fixed page names',async()=>{
  const calls=[];
  const {heroBlocks}=publicBlockReaders({
    live:async()=>{throw Error('Home reader should not run');},
    readRows:async(table,options)=>{
      calls.push([table,options]);
      return {rows:[{page_name:'scope_culture',block_order:2},{page_name:'group_culture',block_order:1}]};
    },
    published:async()=>{throw Error('Live rows must win over release snapshot');}
  });
  const rows=await heroBlocks('lo3rwang','culture');
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'silver.loc_blocks');
  assert.deepEqual(calls[0][1].filters,[
    {column:'page_name',operator:'in',value:['group_culture','scope_culture']}
  ]);
  assert.ok(calls[0][1].limit<=100);
  assert.deepEqual(rows.map(row=>row.page_name),['group_culture','scope_culture']);
});

test('missing Hero rows use only explicit published artwork, not SQL Gateway',async()=>{
  const calls=[];
  const {heroBlocks}=publicBlockReaders({
    live:async()=>[],
    readRows:async()=>({rows:[]}),
    published:async(scope,page)=>{calls.push([scope,page]);return [{block_order:1}]}
  });
  const rows=await heroBlocks('lrunes','trace');
  assert.deepEqual(calls,[['loc','group_trace'],['loc','scope_trace']]);
  assert.deepEqual(rows.map(row=>row.page_name),['group_trace','scope_trace']);
});

test('static Registry cannot take down live Blocks with a retired public RPC',()=>{
  const bootstrap=source.slice(source.indexOf('export function selectPublicSiteBootstrap('),
    source.indexOf('async function fetchRegistryRows('));
  assert.doesNotMatch(bootstrap,/publicAction|read_app_bootstrap|analytics/);
  const home=source.slice(source.indexOf('export async function pageBlocks('),
    source.indexOf('export async function selectScopeBlocks('));
  assert.doesNotMatch(home,/publicAction|gatewayUrl|managedAction/);
  assert.match(home,/selectLiveScopeBlocks\(id,name\)/);
});

test('runtime settings use the existing api.manage table; native four-way work is retained',()=>{
  const runtime=read('app/loc/runtime-config.mjs');
  assert.match(runtime,/client\.schema\('api'\)\.from\('manage'\)/);
  assert.doesNotMatch(runtime,/schema\('silver'\)\.from\('manage'\)/);
  const driver=read('app/loc/providers/kysely-database-drivers.ts');
  for(const dialect of ['PostgresDialect','MysqlDialect','MssqlDialect'])
    assert.ok(driver.includes(dialect),'Missing portable '+dialect);
  const browser=read('app/loc/providers/configured.mjs');
  assert.match(browser,/createLocAccountAdapter/);
  assert.doesNotMatch(browser,/createLocGatewayAdapter|createKyselyEdgeClient/);
  for(const entry of ['functions/index.js','functions/mcp.js'])
    assert.match(read(entry),/directMcpKysely/);
});
