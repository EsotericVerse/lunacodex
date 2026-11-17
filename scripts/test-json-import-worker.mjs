// Runs on the repository's lightweight branch guard with Node built-ins only.
// Mock the browser Worker boundary so no production data, network or DB is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJsonImportOffMainThread} from '../app/loc/import/json-worker-client.mjs';

async function withWorkerMock(behavior,run){
  const original=globalThis.Worker;
  const created=[];
  class FakeWorker {
    constructor(url,options){
      this.url=String(url);
      this.options=options;
      this.terminated=false;
      created.push(this);
    }
    postMessage(payload){
      this.payload=payload;
      behavior(this,payload);
    }
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=FakeWorker;
  try{await run(created);}finally{
    if(original===undefined)delete globalThis.Worker;
    else globalThis.Worker=original;
  }
}

test('JSON Worker resolves source-projected rows and releases its resources',async()=>{
  const stages=[];
  const file={name:'posts.json',size:100};
  await withWorkerMock(worker=>{
    queueMicrotask(()=>worker.onmessage?.({data:{stage:'正在解碼 JSON'}}));
    queueMicrotask(()=>worker.onmessage?.({data:{rows:[{post_content:'內容'}]}}));
  },async created=>{
    const rows=await parseJsonImportOffMainThread(file,
      {source:'WordPress',recordPath:'wp_posts'},{
        onProgress:stage=>stages.push(stage)
      });
    assert.deepEqual(rows,[{post_content:'內容'}]);
    assert.deepEqual(created[0].payload.options,
      {source:'WordPress',recordPath:'wp_posts'});
    assert.equal(created[0].payload.file,file);
    assert.equal(created[0].terminated,true);
    assert.equal(created[0].options.type,'module');
    assert.match(created[0].url,/json-import\.worker\.mjs$/);
    assert.ok(stages.includes('正在解碼 JSON'));
  });
});

test('JSON Worker terminates immediately on cancellation; late replies are ignored',async()=>{
  await withWorkerMock(()=>{},async created=>{
    const controller=new AbortController();
    const pending=parseJsonImportOffMainThread({name:'large.json'},{
      source:'Notion'
    },{signal:controller.signal});
    controller.abort();
    await assert.rejects(pending,/已取消/);
    assert.equal(created[0].terminated,true);
    assert.equal(created[0].onmessage,null);
  });
});

test('JSON parse error is not transformed into an empty successful import',async()=>{
  await withWorkerMock(worker=>{
    queueMicrotask(()=>worker.onmessage?.({data:{error:'JSON 格式不正確'}}));
  },async created=>{
    await assert.rejects(
      parseJsonImportOffMainThread({name:'bad.json'},{source:'Facebook'}),
      /JSON 格式不正確/
    );
    assert.equal(created[0].terminated,true);
  });
});

test('worker transport failure terminates the operation',async()=>{
  await withWorkerMock(worker=>{
    queueMicrotask(()=>worker.onmessageerror?.({}));
  },async created=>{
    await assert.rejects(
      parseJsonImportOffMainThread({name:'oversized.json'},{source:'Threads'}),
      /傳輸失敗/
    );
    assert.equal(created[0].terminated,true);
  });
});
