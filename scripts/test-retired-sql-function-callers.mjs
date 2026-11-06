import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';

const ROOT=new URL('..',import.meta.url).pathname;
const ACTIVE=['app/loc/providers','app/loc/auth','app/loc/mcp','workers',
  'supabase/functions','functions'];
const EXT=/\.(?:js|jsx|mjs|ts|tsx)$/;
const CALL=/\b(?:api\s*\.\s*(?:manage|current_user_id|request_claims)|silver\s*\.\s*(?:current_auth_email|domain_has_repeated_labels|sync_scope_config_display_name|touch_visual_novel_updated_at))\s*\(/g;
const CREATE_TRIGGER=/\bexecute\s+function\s+silver\s*\.\s*(?:sync_scope_config_display_name|touch_visual_novel_updated_at)\s*\(/gi;

function* files(folder){
  for(const ent of readdirSync(join(ROOT,folder),{withFileTypes:true})){
    const path=join(folder,ent.name);
    if(ent.isDirectory())yield* files(path);
    else if(ent.isFile()&&EXT.test(ent.name))yield path;
  }
}
test('active LOC runtime has no direct calls to retired SQL permission/sync functions',()=>{
  const failures=[];
  for(const root of ACTIVE)for(const path of files(root)){
    const source=readFileSync(join(ROOT,path),'utf8');
    // Comments and historical migrations are not runtime dependencies.
    const code=source.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/gm,'');
    for(const pattern of [CALL,CREATE_TRIGGER]){
      pattern.lastIndex=0;
      for(const m of code.matchAll(new RegExp(pattern.source,pattern.flags)))
        failures.push(relative(ROOT,join(ROOT,path))+': '+m[0]);
    }
  }
  assert.deepEqual(failures,[],
    'Replace active SQL functions with LOC Auth, ZenStack schema contract and Kysely operations');
});
