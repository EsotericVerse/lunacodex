import test from 'node:test';
import assert from 'node:assert/strict';
import {isRetryableReadError,readPageWithRetry} from '../app/loc/keywords/discovery-runner.mjs';

test('Transient failures (no status, 5xx, 429, timeout) are retryable',()=>{
  assert.equal(isRetryableReadError(new Error('network blip')),true);
  assert.equal(isRetryableReadError(Object.assign(new Error(),{status:503})),true);
  assert.equal(isRetryableReadError(Object.assign(new Error(),{status:502})),true);
  assert.equal(isRetryableReadError(Object.assign(new Error(),{status:429})),true);
  assert.equal(isRetryableReadError(Object.assign(new DOMException('t','TimeoutError'))),true);
});

test('Real rejections (4xx, caller cancellation) are never retried',()=>{
  assert.equal(isRetryableReadError(Object.assign(new Error(),{status:401})),false);
  assert.equal(isRetryableReadError(Object.assign(new Error(),{status:403})),false);
  assert.equal(isRetryableReadError(Object.assign(new Error(),{status:400})),false);
  assert.equal(isRetryableReadError(Object.assign(new Error(),{name:'AbortError'})),false);
});

test('readPageWithRetry retries a transient failure then succeeds',async()=>{
  let calls=0;
  const result=await readPageWithRetry(async()=>{
    calls++;
    if(calls<3)throw Object.assign(new Error('503'),{status:503});
    return 'ok';
  },null,{baseDelayMs:1});
  assert.equal(result,'ok');
  assert.equal(calls,3,'should have retried twice before succeeding');
});

test('readPageWithRetry gives up after the attempt ceiling, still transient',async()=>{
  let calls=0;
  await assert.rejects(readPageWithRetry(async()=>{
    calls++;
    throw Object.assign(new Error('503'),{status:503});
  },null,{attempts:3,baseDelayMs:1}),/503/);
  assert.equal(calls,3,'should stop at the attempt ceiling, not retry forever');
});

test('readPageWithRetry never retries a non-transient (4xx) failure',async()=>{
  let calls=0;
  await assert.rejects(readPageWithRetry(async()=>{
    calls++;
    throw Object.assign(new Error('forbidden'),{status:403});
  },null,{attempts:4,baseDelayMs:1}),/forbidden/);
  assert.equal(calls,1,'a real rejection must fail immediately, not after retries');
});

test('readPageWithRetry stops immediately once the caller signal aborts',async()=>{
  const controller=new AbortController();
  let calls=0;
  const promise=readPageWithRetry(async()=>{
    calls++;
    controller.abort();
    throw Object.assign(new Error('503'),{status:503});
  },controller.signal,{attempts:5,baseDelayMs:1});
  await assert.rejects(promise,error=>error.name==='AbortError');
  assert.equal(calls,1,'cancellation must win over any further retry attempt');
});
