// Run after npm ci: node scripts/test-local-scope-session.mjs
// Pure lease checks plus real ZenStack/Zod local Galaxy payload validation.
// No native device, network, SQL, or production database.
import assert from 'node:assert/strict';
import {
  LOCAL_SCOPE_MAX_MS,validLocalDeadline,formatLocalCountdown,
  LOCAL_SCOPE_LEASE_KEY,LOCAL_SCOPE_LEASE_CHANGED,
  startLocalDeadline,stopLocalDeadline,getLocalDeadline,
  hasExpiredLocalDeadline,subscribeLocalDeadline
} from '../app/loc/local-scope-session.mjs';
import {
  parseLocalGalaxyArchive,normalizeLocalGalaxyRow,
  LOCAL_GALAXY_DB,LOCAL_GALAXY_STORE
} from '../app/loc/local-scope-galaxy.mjs';

const now=Date.now();
assert.equal(validLocalDeadline(now+15000,now),now+15000);
assert.equal(validLocalDeadline(now-1,now),0);
assert.equal(validLocalDeadline(now+LOCAL_SCOPE_MAX_MS+1,now),0);
assert.equal(formatLocalCountdown(now+61000,now),'01:01');
assert.equal(formatLocalCountdown(now+3661000,now),'01:01:01');
assert.equal(formatLocalCountdown(0,now),'00:00');
assert.equal(LOCAL_GALAXY_DB,'loc-local-galaxy-v1');
assert.equal(LOCAL_GALAXY_STORE,'galaxy');
const records=new Map(),listeners=new Map();
globalThis.window={
  localStorage:{
    getItem:key=>records.get(key)??null,
    setItem:(key,value)=>records.set(key,value),
    removeItem:key=>records.delete(key)
  },
  addEventListener:(key,fn)=>listeners.set(key,fn),
  removeEventListener:key=>listeners.delete(key),
  dispatchEvent:event=>{listeners.get(event.type)?.(event);return true}
};
let updates=0;
const unsubscribe=subscribeLocalDeadline(()=>updates++);
const deadline=startLocalDeadline(15);
assert.ok(deadline>Date.now());
assert.equal(getLocalDeadline(),deadline);
assert.equal(updates,1);
assert.equal(hasExpiredLocalDeadline(deadline+1),true);
stopLocalDeadline();
assert.equal(getLocalDeadline(),0);
assert.equal(updates,2);
unsubscribe();
assert.equal(listeners.has(LOCAL_SCOPE_LEASE_CHANGED),false);
assert.equal(records.has(LOCAL_SCOPE_LEASE_KEY),false);
assert.throws(()=>startLocalDeadline(180),/15／30／60/);

const sample={
  uid:'POST0001',site:'example_site',site_id:'external-1',
  title:'原文',content:'文字中的 空白 必須保留',
  location:'不同空格  就是不同地點',
  createtime:'2026-11-14T08:00:00Z',UpdateTime:'2026-11-14T09:00:00Z',
  date:'2026-11-14',culture:true,statics:true,trace:false,
  search:true,list:true,keyword:false
};
const first=normalizeLocalGalaxyRow(sample);
assert.equal(first.content,sample.content);
assert.equal(first.location,sample.location);
assert.equal(first.site,sample.site);
assert.equal(first.uid,sample.uid);
assert.equal(first.createtime,'2026-11-14T08:00:00.000Z');
assert.equal(first.UpdateTime,'2026-11-14T09:00:00.000Z');
assert.equal(first.date,'2026-11-14');
assert.equal(first.culture,true);
assert.equal(first.statics,true);
assert.equal(first.trace,false);
assert.deepEqual(parseLocalGalaxyArchive({records:[sample]}),[first]);
assert.throws(()=>parseLocalGalaxyArchive({records:[sample,sample]}),/重複 UID/);
assert.throws(()=>parseLocalGalaxyArchive({records:[{...sample,uid:'BAD UID!'}]}),/八碼/);
assert.throws(()=>parseLocalGalaxyArchive({records:[{...sample,content:' '}]}),/不能沒有內容/);
assert.throws(()=>parseLocalGalaxyArchive({records:[{...sample,unsafe_column:1}]}),/不支援欄位/);
assert.throws(()=>parseLocalGalaxyArchive({records:[{...sample,createtime:'invalid'}]}),/日期無效/);
assert.throws(()=>parseLocalGalaxyArchive({records:[{...sample,media_link:['NOT-UID!']}]}),/UID 清單/);
console.log('PASS: Local Scope ZModel Galaxy contract, literal records, lease expiry and hard switch');
