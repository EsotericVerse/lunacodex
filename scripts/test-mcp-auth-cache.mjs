import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('MCP read and search use read authorization, not write authorization',()=>{
  const edge=read('supabase/functions/loc-kysely/index.ts');
  const authority=read('workers/loc-authority/index.mjs');
  assert.match(edge,/const reading=kind==="mcp-read"\|\|kind==="mcp-search"/);
  assert.match(edge,/authorize-"\+\(reading\?"read":"write"\)/);
  assert.match(authority,/\['authorize-read','authorize-write'\]/);
  assert.match(authority,/source==='github'\?'manage':'read'/);
  assert.match(authority,/if\(!isRoot\|\|!await allowed\(scopeid,action\)\)/);
  assert.match(edge,/reading&&source==="github"/);
  assert.match(edge,/jwtVerify\(token,clerkKeys/);
});
test('parallel MCP requests coalesce only the same token, Scope and permission',()=>{
  const edge=read('supabase/functions/loc-kysely/index.ts');
  assert.match(edge,/pending:Promise<string>/);
  assert.match(edge,/const email=await cached\.pending/);
  assert.match(edge,/const key=scopeid\+":"\+action\+":"\+fingerprint/);
  assert.match(edge,/mcpGrantCache\.get\(key\)\?\.pending===pending/);
  assert.match(edge,/Math\.min\(now\+30000,Number\(payload\.exp\)\*1000\)/);
  assert.match(edge,/if\(!response\.ok\)throw/);
});

test('only short-lived verified per-Scope grants are cached; raw tokens never retained',()=>{
  const edge=read('supabase/functions/loc-kysely/index.ts');
  assert.match(edge,/crypto\.subtle\.digest\("SHA-256"/);
  assert.match(edge,/Math\.min\(now\+30000,Number\(payload\.exp\)\*1000\)/);
  assert.match(edge,/const key=scopeid\+":"\+action\+":"\+fingerprint/);
  assert.match(edge,/mcpGrantCache\.size>64/);
  assert.match(edge,/if\(!response\.ok\)throw/);
  assert.doesNotMatch(edge,/mcpGrantCache\.set\([^\n]*token/);
});
