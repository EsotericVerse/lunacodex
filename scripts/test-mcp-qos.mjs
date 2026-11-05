import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
  .replace(/^import[\\s\\S]*?;\\s*$/gm,'')
  .replace('export class LocAuthorityState','class LocAuthorityState')
  .replace('export default {','const worker={');
const {LocAuthorityState}=new Function('DurableObject',
  source+';return {LocAuthorityState};')(class {
    constructor(ctx,env){this.ctx=ctx;this.env=env;}
  });
function quota(){
  const data=new Map();
  const storage={
    get:async key=>data.get(key),
    put:async(key,value)=>{data.set(key,value);},
    transaction:async fn=>fn(storage)
  };
  return new LocAuthorityState({storage},{});
}
const who='clerk:user_QoSTest';
test('MCP QoS reserves four slots for writes and enforces 16 total',async()=>{
  const authority=quota(),tickets=[];
  for(let i=0;i<12;i++)tickets.push(await authority.mcpQuotaAcquire('read',who));
  await assert.rejects(authority.mcpQuotaAcquire('read',who),
    error=>error.status===429);
  for(let i=0;i<4;i++)tickets.push(await authority.mcpQuotaAcquire('write',who));
  assert.equal(tickets.length,16);
  assert.equal(new Set(tickets.map(item=>item.lease)).size,16);
  // Other account reaches global concurrency cap without exhausting its own rate quota.
  const other='clerk:user_Other';
  await assert.rejects(authority.mcpQuotaAcquire('write',other),error=>error.status===429);
  const suspended=await authority.ctx.storage.get('mcp-qos-cooldown:'+other);
  assert.ok(suspended>Date.now()+170000);
  for(const ticket of tickets)await authority.mcpQuotaRelease(ticket.lease,who);
  // The durable cooldown persists even after active leases are released.
  await assert.rejects(authority.mcpQuotaAcquire('write',other),error=>error.status===429);
  await assert.rejects(authority.mcpQuotaAcquire('read',who),error=>error.status===429);
  const next=await authority.mcpQuotaAcquire('read','clerk:user_Third');
  await authority.mcpQuotaRelease(next.lease,'clerk:user_Third');
});
test('MCP QoS refuses cross-account release and invalid principal',async()=>{
  const authority=quota(),ticket=await authority.mcpQuotaAcquire('write',who);
  await assert.rejects(authority.mcpQuotaRelease(ticket.lease,'clerk:user_Other'),
    error=>error.status===403);
  await assert.rejects(authority.mcpQuotaAcquire('read','not-clerk'),
    error=>error.status===401);
  assert.deepEqual(await authority.mcpQuotaRelease(ticket.lease,who),{released:true});
});

test('Galaxy Link searches have a separate low-rate budget',async()=>{
  const authority=quota();
  const subject='clerk:user_Search';
  const one=await authority.mcpQuotaAcquire('search',subject);
  const two=await authority.mcpQuotaAcquire('search',subject);
  await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
  await authority.mcpQuotaRelease(one.lease,subject);
  await authority.mcpQuotaRelease(two.lease,subject);
  await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
  const read=await authority.mcpQuotaAcquire('read',subject);
  await authority.mcpQuotaRelease(read.lease,subject);
});

test('three repeated minute-limit refusals cause a durable three-minute cooldown',async()=>{
  const authority=quota(),subject='clerk:user_RepeatRate',leases=[];
  for(let i=0;i<16;i++)leases.push(await authority.mcpQuotaAcquire('write',subject));
  await assert.rejects(authority.mcpQuotaAcquire('write',subject),error=>error.status===429);
  assert.equal(await authority.ctx.storage.get('mcp-qos-cooldown:'+subject),undefined);
  await assert.rejects(authority.mcpQuotaAcquire('write',subject),error=>error.status===429);
  assert.equal(await authority.ctx.storage.get('mcp-qos-cooldown:'+subject),undefined);
  await assert.rejects(authority.mcpQuotaAcquire('write',subject),error=>error.status===429);
  assert.ok((await authority.ctx.storage.get('mcp-qos-cooldown:'+subject))>Date.now()+170000);
  for(const lease of leases)await authority.mcpQuotaRelease(lease.lease,subject);
  await assert.rejects(authority.mcpQuotaAcquire('read',subject),error=>error.status===429);
  const unaffected=await authority.mcpQuotaAcquire('read','clerk:user_OtherRate');
  await authority.mcpQuotaRelease(unaffected.lease,'clerk:user_OtherRate');
});

test('three repeated Galaxy Link search violations trigger three-minute cooldown',async()=>{
  const authority=quota(),subject='clerk:user_SearchBurst',leases=[];
  leases.push(await authority.mcpQuotaAcquire('search',subject));
  leases.push(await authority.mcpQuotaAcquire('search',subject));
  for(let i=0;i<2;i++){
    await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
    assert.equal(await authority.ctx.storage.get('mcp-qos-cooldown:'+subject),undefined);
  }
  await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
  assert.ok((await authority.ctx.storage.get('mcp-qos-cooldown:'+subject))>Date.now()+170000);
  for(const lease of leases)await authority.mcpQuotaRelease(lease.lease,subject);
  await assert.rejects(authority.mcpQuotaAcquire('write',subject),error=>error.status===429);
});
