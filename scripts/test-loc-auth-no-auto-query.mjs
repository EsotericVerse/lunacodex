import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('session management never retries auth on visibility or reconnect',()=>{
  const source=read('app/loc/use-account.js');
  assert.doesNotMatch(source,/addEventListener\('online',recheck\)/);
  assert.doesNotMatch(source,/addEventListener\('visibilitychange',onVisible\)/);
  assert.match(source,/refetchType:'none'/);
});

test('resource options never override no-refetch policy',()=>{
  const source=read('zenstack/client-queries.js');
  assert.match(source,/\.\.\.rest,\.\.\.defaults,queryKey,/);
  assert.match(source,/refetchOnMount:false/);
  assert.match(source,/refetchInterval:false/);
});
