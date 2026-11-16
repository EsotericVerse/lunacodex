import test from 'node:test';
import assert from 'node:assert/strict';
import {auditContainsGhsa,assertCriticalAdvisory,assertWorkerVersion,changedDirectDependencies}
  from './attest-lrs-emergency.mjs';
const id='GHSA-cfgh-jmpq-rvwx';
const version='0612f4d7-338f-472c-a71c-fa646cf72bdb';
test('Only published, non-withdrawn critical GHSA passes attestation',()=>{
 const a={ghsa_id:id,severity:'critical',withdrawn_at:null,
  published_at:'2026-11-01T00:00:00Z'};
 assert.ok(assertCriticalAdvisory(a,id));
 assert.throws(()=>assertCriticalAdvisory({...a,severity:'low'},id),/critical/);
 assert.throws(()=>assertCriticalAdvisory({...a,withdrawn_at:'2026-11-17'},id),/critical/);
});
test('npm audit must actually identify the targeted advisory in pinned source',()=>{
 const vulnerable={vulnerabilities:{foo:{via:[{url:'https://github.com/advisories/'+id}]}},metadata:{vulnerabilities:{critical:1}}};
 assert.equal(auditContainsGhsa(vulnerable,id),true);
 assert.equal(auditContainsGhsa({vulnerabilities:{}},id),false);
 assert.throws(()=>auditContainsGhsa({error:{code:'EAI_AGAIN'}},id),/unavailable/);
});
test('Deployed Cloudflare version cannot be overwritten or replayed',()=>{
 const request={reason:'security',workerVersionId:version};
 assert.equal(assertWorkerVersion([{versions:[{version_id:version}]}],request,'before'),version);
 assert.throws(()=>assertWorkerVersion([{versions:[{version_id:version}]}],request,'after'),/new Worker version/);
 assert.throws(()=>assertWorkerVersion([{versions:[{version_id:'changed'}]}],request,'before'),/refuse replay/);
 assert.throws(()=>assertWorkerVersion([],request,'before'),/unverifiable/);
 const boot={reason:'bootstrap',workerVersionId:null};
 assert.equal(assertWorkerVersion([],boot,'before'),null);
 assert.throws(()=>assertWorkerVersion([{versions:[{version_id:version}]}],boot,'before'),/baseline exists/);
});

test('Missing lockfile may not masquerade as a code dependency fix',()=>{
 const a={dependencies:{kysely:'0.29.7',pg:'8.23.1'},devDependencies:{wrangler:'^4.148.0'}};
 const b={dependencies:{kysely:'0.29.8',pg:'8.23.1'},devDependencies:{wrangler:'^4.148.0'}};
 assert.deepEqual(changedDirectDependencies(a,b),['kysely']);
 assert.deepEqual(changedDirectDependencies(a,a),[]);
});
