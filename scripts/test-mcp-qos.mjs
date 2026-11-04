import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';",'')
  .replace("import {validateKeywordCategoryEntry,hashKeywordCategory,assertPublicKeywordClass} from './keyword-categories.mjs';",'')
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
test('MCP QoS reserves 4 calls for writes within global 16 slots',async()=>{
  const authority=quota(),tickets=[];
  for(let i=0;i<12;i++)tickets.push(await authority.mcpQuotaAcquire('read',who));
  await assert.rejects(authority.mcpQuotaAcquire('read',who),
    error=>error.status===429);
  for(let i=0;i<4;i++)tickets.push(await authority.mcpQuotaAcquire('write',who));
  await assert.rejects(authority.mcpQuotaAcquire('write',who),
    error=>error.status===429);
  assert.equal(tickets.length,16);
  assert.equal(new Set(tickets.map(item=>item.lease)).size,16);
  await assert.rejects(authority.mcpQuotaAcquire('write','clerk:user_Other'),
    error=>error.status===429);
  for(const ticket of tickets)await authority.mcpQuotaRelease(ticket.lease,who);
  await assert.rejects(authority.mcpQuotaAcquire('read',who),
    error=>error.status===429);
  const next=await authority.mcpQuotaAcquire('read','clerk:user_Other');
  await authority.mcpQuotaRelease(next.lease,'clerk:user_Other');
});
test('MCP QoS refuses cross-account release and invalid principal',async()=>{
  const authority=quota(),ticket=await authority.mcpQuotaAcquire('write',who);
  await assert.rejects(authority.mcpQuotaRelease(ticket.lease,'clerk:user_Other'),
    error=>error.status===403);
  await assert.rejects(authority.mcpQuotaAcquire('read','not-clerk'),
    error=>error.status===401);
  assert.deepEqual(await authority.mcpQuotaRelease(ticket.lease,who),{released:true});
});
