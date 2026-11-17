import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {
  verifyLasNotification,hasPublishedLasCheck,receiptPath,validateLocPagesHook,
  LAS_REPO,LOC_REPO,STATE_BRANCH,EVENT
} from './las-deploy-authorization.mjs';
const now=Date.parse('2026-11-17T02:00:00.000Z');
const secret='test-only-signed-las-release-key-not-for-production';
const sample={
  schema:'loc.las-published.v1',
  repo:LAS_REPO,target:LOC_REPO,sha:'a'.repeat(40),
  worker:'lunarcus',version:'4aee6c75-3997-4d30-bb47-502aa603589e',
  issuedAt:new Date(now-30000).toISOString(),expiresAt:new Date(now+270000).toISOString()
};
const order=['schema','repo','target','sha','worker','version','issuedAt','expiresAt'];
const signed=request=>({
  request,
  signature:createHmac('sha256',secret).update(order.map(k=>String(request[k]??'')).join('\n')).digest('hex')
});
test('LAS notification signature, TTL and pinned identities pass',()=>{
  const value=verifyLasNotification(signed(sample),secret,now);
  assert.equal(value.repo,LAS_REPO);
  assert.equal(value.target,LOC_REPO);
  assert.equal(EVENT,'loc-las-published');
  assert.equal(STATE_BRANCH,'las-deployment-receipts');
  assert.equal(receiptPath(value),'las-deployments/'+sample.version+'.json');
});
test('LOC rejects forged, mismatched, expired and future notifications',()=>{
  assert.throws(()=>verifyLasNotification(signed(sample),'',now),/unavailable/);
  assert.throws(()=>verifyLasNotification({...signed(sample),signature:'0'.repeat(64)},secret,now),/mismatch/);
  for(const variant of [
    {...sample,target:'EsotericVerse/lunarunes'},
    {...sample,sha:'b'.repeat(40),target:'other'},
    {...sample,worker:'loc-authority'},
    {...sample,version:'../bad'},
    {...sample,issuedAt:new Date(now+120000).toISOString()},
    {...sample,expiresAt:new Date(now-100).toISOString()},
    {...sample,expiresAt:new Date(now+900000).toISOString()},
    {...sample,grant:true}
  ])assert.throws(()=>verifyLasNotification(signed(variant),secret,now));
});
test('Cloudflare published version check is required',()=>{
  const good={name:'Workers Builds: lunarcus',app:{slug:'cloudflare-workers-and-pages'},
    status:'completed',conclusion:'success'};
  assert.equal(hasPublishedLasCheck([good]),true);
  assert.equal(hasPublishedLasCheck([{...good,conclusion:'failure'}]),false);
  assert.equal(hasPublishedLasCheck([{...good,app:{slug:'someone-else'}}]),false);
  assert.equal(hasPublishedLasCheck([]),false);
});
test('LOC Pages trigger rejects external URLs, query injection or other domains',()=>{
  const allowed='https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/'+
    'test-dummy-value-not-a-secret';
  assert.equal(validateLocPagesHook(allowed),allowed);
  for(const url of [
    'https://example.com/client/v4/pages/webhooks/deploy_hooks/abc',
    'https://api.cloudflare.com.evil.test/client/v4/pages/webhooks/deploy_hooks/abc',
    allowed+'?token=leak',
    'http://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abc',
    'https://user:pass@api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abc'
  ])assert.throws(()=>validateLocPagesHook(url));
});
test('LOC workflow uses only signed dispatch and owns the Pages trigger',async()=>{
  const {readFileSync}=await import('node:fs');
  const workflow=readFileSync(new URL('../.github/workflows/receive-las-deployment.yml',import.meta.url),'utf8');
  assert.ok(workflow.includes('repository_dispatch:'));
  assert.ok(workflow.includes('loc-las-published'));
  assert.ok(workflow.includes('secrets.LOC_WORKFLOW_KEY'));
  assert.ok(workflow.includes('secrets.LOC_PAGES_DEPLOY_HOOK'));
  assert.ok(!workflow.includes('push:'));
  assert.ok(!workflow.includes('secrets.CLOUDFLARE_API_TOKEN'));
  const guard=readFileSync(new URL('./check-workflow-triggers.rb',import.meta.url),'utf8');
  assert.ok(guard.includes("File.basename(file) == 'receive-las-deployment.yml'"));
});
