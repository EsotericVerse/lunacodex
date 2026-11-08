import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planHomeBlockWrites} from '../app/loc/home-block-draft-plan.mjs';

const block=(uid,order,title,extra={})=>({
  uid,order,title,text:'<p>'+title+'</p>',stored:true,_deleted:false,entities:[],...extra
});
const original=[block('aB12cD34',1,'首頁'),block('eF56gH78',2,'關於'),block('iJ90kL12',3,'作品')];

test('changing one block never rewrites every homepage block',()=>{
  const edited=original.map(x=>({...x}));
  edited[1]={...edited[1],title:'關於我'};
  const plan=planHomeBlockWrites(edited,original);
  assert.deepEqual(plan.changed.filter(x=>x.modified).map(x=>x.draft.uid),['eF56gH78']);
  assert.equal(plan.deleted.length,0);
  assert.equal(plan.hasWrites,true);
});

test('untouched empty homepage placeholder does not block another edit',()=>{
  const empty={uid:'',order:4,title:'',text:'',stored:false,_deleted:false,entities:[]};
  const initial=[...original,empty];
  const edited=initial.map(x=>({...x}));
  edited[0]={...edited[0],text:'<p>更新首頁</p>'};
  const plan=planHomeBlockWrites(edited,initial);
  assert.equal(plan.changed.find(x=>x.draft.order===4).modified,false);
  assert.deepEqual(plan.changed.filter(x=>x.modified).map(x=>x.draft.uid),['aB12cD34']);
});

test('new content inserts only its own block',()=>{
  const added=block('mN34oP56',4,'最新文章',{stored:false});
  const plan=planHomeBlockWrites([...original,added],original);
  assert.deepEqual(plan.changed.filter(x=>x.modified).map(x=>x.draft.uid),[added.uid]);
});

test('deletion includes the requested row and downstream order updates',()=>{
  const removed={...original[0],_deleted:true};
  const plan=planHomeBlockWrites([removed,original[1],original[2]],original);
  assert.deepEqual(plan.deleted.map(x=>x.uid),[removed.uid]);
  assert.deepEqual(plan.changed.filter(x=>x.modified).map(x=>x.draft.uid),['eF56gH78','iJ90kL12']);
  assert.deepEqual(plan.changed.map(x=>x.order),[1,2]);
});

test('preserved ordering skips unchanged rows, including visual placeholders',()=>{
  const plan=planHomeBlockWrites(original,original,{preserveOrder:true});
  assert.equal(plan.hasWrites,false);
  assert.equal(plan.changed.filter(x=>x.modified).length,0);
});
test('homepage entry performs live Auth/permission verification and exposes errors',()=>{
  const entry=readFileSync(new URL('../app/loc/ScopeHomeEditEntry.jsx',import.meta.url),'utf8');
  const account=readFileSync(new URL('../app/loc/use-account.js',import.meta.url),'utf8');
  const restore=readFileSync(new URL('../app/loc/HomeEditModeRestore.jsx',import.meta.url),'utf8');
  const draft=readFileSync(new URL('../app/loc/ScopeBlockDraftList.jsx',import.meta.url),'utf8');
  assert.match(entry,/account\.refresh\(\)/);
  assert.match(entry,/message\.error\|\|/);
  assert.match(entry,/前往設定首頁使用 LOC Auth 登入/);
  assert.match(restore,/readHomeEditorAccess\(window\.sessionStorage\)/);
  assert.match(account,/if\(result\?\.error\)throw new Error\(result\.error\)/);
  assert.doesNotMatch(account,/cachedManagementAccount|MANAGEMENT_REVERIFY_TTL_MS|lastVerifiedAt/);
  assert.match(account,/let pendingManagementVerification=null/);
  assert.match(account,/readLocEditorGrants\(session/);
  assert.doesNotMatch(account,/managedAction\(['"]manage['"]/);
  assert.match(account,/const result=await mutate\(queryKey,fetcher,\{revalidate:false\}\)/);
  assert.match(draft,/planHomeBlockWrites/);
  assert.match(draft,/if\(plan\.hasWrites\)/);
  assert.match(draft,/refreshWarning/);
});
