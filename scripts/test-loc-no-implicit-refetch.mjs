import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('resource options cannot override disabled background refetch',()=>{
  const source=read('zenstack/client-queries.js');
  assert.match(source,/staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false,/);
  assert.match(source,/refetchOnReconnect:false,refetchInterval:false,retry:false/);
  assert.match(source,/\.\.\.rest,\.\.\.defaults,queryKey,/);
  assert.doesNotMatch(source,/\.\.\.defaults,\.\.\.rest,queryKey,/);
});

test('shared resource invalidation never immediately refetches active queries',()=>{
  const source=read('zenstack/client-queries.js');
  const calls=[...source.matchAll(/invalidateQueries\(\{([^}]+)\}\)/g)];
  assert.ok(calls.length>=3);
  for(const [,args] of calls)assert.match(args,/refetchType:'none'/);
});

test('AppShell query defaults disable automatic polling',()=>{
  const source=read('app/AppShell.jsx');
  assert.match(source,/refetchOnMount:false,refetchOnWindowFocus:false,/);
  assert.match(source,/refetchOnReconnect:false,refetchInterval:false,retry:false/);
});
