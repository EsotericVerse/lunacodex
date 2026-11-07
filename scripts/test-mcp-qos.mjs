import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
  .replace(/^import[\\s\\S]*?;\\s*$/gm,'')
  .replace('export class LocAuthorityState','class LocAuthorityState')
  .replace('export default {','const worker={');
const {LocAuthorityState,mcpPrLookup}=new Function('DurableObject',
  source+';return {LocAuthorityState,mcpPrLookup};')(class {
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
  await assert.rejects(authority.mcpQuotaAcquire('search',subject),e=>e.status===429&&/五分鐘/.test(e.message));
  const counter=await authority.ctx.storage.get('mcp-qos-search:'+subject);
  assert.equal(counter.count,1);
  assert.equal(counter.rejects,1);
  const two=await authority.mcpQuotaAcquire('read',subject);
  await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
  await authority.mcpQuotaRelease(one.lease,subject);
  await authority.mcpQuotaRelease(two.lease,subject);
  // The third rejected search activates the existing global cooldown, so a
  // subsequent read is expected to reject rather than be allowed.
  await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
  await assert.rejects(authority.mcpQuotaAcquire('read',subject),error=>error.status===429);
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
  for(let i=0;i<2;i++){
    await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
    assert.equal(await authority.ctx.storage.get('mcp-qos-cooldown:'+subject),undefined);
  }
  await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
  assert.ok((await authority.ctx.storage.get('mcp-qos-cooldown:'+subject))>Date.now()+170000);
  for(const lease of leases)await authority.mcpQuotaRelease(lease.lease,subject);
  await assert.rejects(authority.mcpQuotaAcquire('write',subject),error=>error.status===429);
});

test('repeated cooldown incidents escalate 3/6/12/24/48/60 minutes, then cap',async()=>{
  const authority=quota(),subject='clerk:user_Escalation';
  const base=Date.now(),duration=[3,6,12,24,48,60,60];
  // Seed a full search quota so each three refused search attempts is a new incident.
  const tickets=[await authority.mcpQuotaAcquire('search',subject)];
  for(let i=0;i<duration.length;i++){
    // Simulate a cooled-off client and fresh minute window, without changing
    // the global Date clock or weakening the production implementation.
    await authority.ctx.storage.put('mcp-qos-cooldown:'+subject,base-1);
    await authority.ctx.storage.put('mcp-quota-window:'+subject,
      {started:base,count:2,reads:2,searches:2,rateRejects:0});
    await authority.ctx.storage.put('mcp-qos-search:'+subject,{at:base,count:i+1,rejects:0});
    for(let j=0;j<3;j++)
      await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
    const until=await authority.ctx.storage.get('mcp-qos-cooldown:'+subject);
    const minutes=(until-Date.now())/60000;
    assert.ok(minutes<=duration[i]&&minutes>duration[i]-0.1,
      'incident '+(i+1)+' must cooldown for '+duration[i]+' minutes');
    const before=await authority.ctx.storage.get('mcp-qos-strikes:'+subject);
    await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
    const after=await authority.ctx.storage.get('mcp-qos-strikes:'+subject);
    assert.deepEqual(after,before,'blocked retries must not extend cooldown');
  }
  const prior=await authority.ctx.storage.get('mcp-qos-strikes:'+subject);
  await authority.ctx.storage.put('mcp-qos-strikes:'+subject,
    {...prior,at:Date.now()-86_400_001});
  await authority.ctx.storage.put('mcp-qos-cooldown:'+subject,base-1);
  await authority.ctx.storage.put('mcp-quota-window:'+subject,
    {started:base,count:2,reads:2,searches:2,rateRejects:0});
  await authority.ctx.storage.put('mcp-qos-search:'+subject,{at:base,count:9,rejects:0});
  for(let j=0;j<3;j++)
    await assert.rejects(authority.mcpQuotaAcquire('search',subject),error=>error.status===429);
  const reset=(await authority.ctx.storage.get('mcp-qos-cooldown:'+subject)-Date.now())/60000;
  assert.ok(reset<=3&&reset>2.9,'24 hours without incidents resets escalation');
  for(const t of tickets)await authority.mcpQuotaRelease(t.lease,subject);
});

test('Rejected searches never reset the first accepted search timestamp',async()=>{
  const authority=quota(),subject='clerk:user_SearchStable';
  const ticket=await authority.mcpQuotaAcquire('search',subject);
  const before=await authority.ctx.storage.get('mcp-qos-search:'+subject);
  for(let i=0;i<2;i++)await assert.rejects(authority.mcpQuotaAcquire('search',subject),e=>e.status===429);
  const after=await authority.ctx.storage.get('mcp-qos-search:'+subject);
  assert.equal(after.at,before.at);
  assert.equal(after.count,1);
  assert.equal(after.rejects,2);
  await authority.mcpQuotaRelease(ticket.lease,subject);
});

test('One search becomes eligible again after five minutes without resetting historic count',async()=>{
  const authority=quota(),subject='clerk:user_SearchWindow';
  const first=await authority.mcpQuotaAcquire('search',subject);
  const key='mcp-qos-search:'+subject;
  const old=await authority.ctx.storage.get(key);
  await authority.ctx.storage.put(key,{...old,at:Date.now()-300001});
  const second=await authority.mcpQuotaAcquire('search',subject);
  const next=await authority.ctx.storage.get(key);
  assert.equal(next.count,2);
  assert.equal(next.rejects,0);
  assert.ok(next.at>=old.at);
  await authority.mcpQuotaRelease(first.lease,subject);
  await authority.mcpQuotaRelease(second.lease,subject);
});

test('PR classifier routes Github lookups away from Galaxy',()=>{
  for(const term of ['PR','PR #1172','請找PR紀錄','pull request #1172','github commit','拉取請求'])
    assert.equal(mcpPrLookup(term),true,term);
  for(const term of ['時間定錨','對話摘要','跨 Agent 紀錄'])
    assert.equal(mcpPrLookup(term),false,term);
});

test('read-only QoS inspection warns at the penultimate slot without spending quota',async()=>{
 const authority=quota(),subject='clerk:user_Inspect';
 assert.deepEqual(await authority.mcpQuotaInspect('search',subject),{warning:''});
 const ticket=await authority.mcpQuotaAcquire('search',subject);
 assert.match(ticket.warning,/五分鐘/);
 const before=await authority.ctx.storage.get('mcp-qos-search:'+subject);
 const near=await authority.mcpQuotaInspect('search',subject);
 assert.match(near.warning,/五分鐘/);
 const after=await authority.ctx.storage.get('mcp-qos-search:'+subject);
 assert.deepEqual(after,before,'inspection must not record a search or rejected attempt');
 await authority.mcpQuotaRelease(ticket.lease,subject);
});

test('QoS warns before the final read allowance, without weakening 429 limits',async()=>{
 const authority=quota(),subject='clerk:user_PreLimit',leases=[];
 for(let i=0;i<10;i++)leases.push(await authority.mcpQuotaAcquire('read',subject));
 const notice=await authority.mcpQuotaInspect('read',subject);
 assert.deepEqual(notice,{warning:''});
 const penultimate=await authority.mcpQuotaAcquire('read',subject);
 assert.match(penultimate.warning,/即將達到限制/);
 leases.push(penultimate);
 const peek=await authority.mcpQuotaInspect('read',subject);
 assert.match(peek.warning,/即將達到限制/);
 leases.push(await authority.mcpQuotaAcquire('read',subject));
 await assert.rejects(authority.mcpQuotaAcquire('read',subject),e=>e.status===429);
 for(const ticket of leases)await authority.mcpQuotaRelease(ticket.lease,subject);
});
