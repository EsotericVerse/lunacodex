import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {readPublishedBootstrap} from '../app/api/loc/_numeric-failover.mjs';

test('public snapshots can publish from Backup SQL Gateway when Primary SQL Gateway fails',async()=>{
  const used=[];
  const sources=['primary','backup'].map(id=>({
    id,schema:()=>({publicAction:async(name,args)=>{
      used.push(id);
      assert.equal(name,'read_app_bootstrap');
      assert.equal(args.p_scope_id,'loc');
      return id==='primary'?{error:{message:'fetch failed'},status:0}
        :{data:{registry:[{scope_id:'lo3rwang'}]}};
    }})
  }));
  const result=await readPublishedBootstrap(sources);
  assert.deepEqual(used,['primary','backup']);
  assert.equal(result.source,'backup');
  assert.equal(result.data.registry[0].scope_id,'lo3rwang');
  assert.equal(typeof result.client.publicAction,'function');
});
test('public publisher cannot mask permission errors or bad bootstrap with a fallback',async()=>{
  let called=0;
  const sources=[
    {id:'primary',schema:()=>({publicAction:async()=>{
      called++;
      return {error:{message:'Forbidden'},status:403};
    }})},
    {id:'backup',schema:()=>{throw Error('Should not reach fallback');}}
  ];
  await assert.rejects(readPublishedBootstrap(sources),/Cannot publish public Bootstrap/);
  assert.equal(called,1);
  await assert.rejects(readPublishedBootstrap([
    {id:'backup',schema:()=>({publicAction:async()=>({data:{registry:'not-array'}})})}
  ]),/Invalid public Bootstrap/);
});
test('explicit publishing keeps the existing snapshot and static-export boundaries',()=>{
  const src=readFileSync(new URL('../scripts/generate-public-blocks.mjs',import.meta.url),'utf8');
  assert.match(src,/readPublishedBootstrap\(publicNumericSources\(\)\)/);
  assert.match(src,/publishPublicFiles\(root,entries\)/);
  assert.doesNotMatch(readFileSync(new URL('../scripts/build-static-export.mjs',import.meta.url),'utf8'),/generate-public-blocks/);
});
