import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {webcrypto} from 'node:crypto';
import {
  createPrivateLocalStore,privateFilePath,PRIVATE_FILE_CHUNK_BYTES,
  PRIVATE_FILE_READ_MAX_BYTES
} from '../app/loc/private-local-files.mjs';

globalThis.File??=File;
globalThis.crypto??=webcrypto;

// In-memory stand-in for Capacitor Filesystem. All paths use LibraryNoCloud;
// no network/database stub or public Scope is involved.
function fakeFilesystem(){
  const files=new Map(),directories=new Set();
  const notFound=()=>Object.assign(new Error('File does not exist'),{code:'ENOENT'});
  return {
    files,
    async stat({path}){
      if(directories.has(path))return {size:0};
      const value=files.get(path);
      if(!value)throw notFound();
      return {size:value.byteLength};
    },
    async mkdir({path}){directories.add(path);},
    async writeFile({path,data,encoding}){
      files.set(path,Buffer.from(data,encoding==='utf8'?'utf8':'base64'));
    },
    async appendFile({path,data,encoding}){
      const old=files.get(path);
      if(!old)throw notFound();
      files.set(path,Buffer.concat([old,Buffer.from(data,encoding==='utf8'?'utf8':'base64')]));
    },
    async readFile({path,encoding}){
      const value=files.get(path);
      if(!value)throw notFound();
      return {data:value.toString(encoding==='utf8'?'utf8':'base64')};
    },
    async deleteFile({path}){
      if(!files.has(path))throw notFound();
      files.delete(path);
    },
    async getUri({path}){
      if(!files.has(path))throw notFound();
      return {uri:'file:///LibraryNoCloud/'+path};
    }
  };
}

test('offline LocalFile write and reopen preserve exact binary bytes across native chunks',async()=>{
  const fs=fakeFilesystem();
  const store=createPrivateLocalStore(fs,'LIBRARY_NO_CLOUD');
  const bytes=Buffer.alloc(PRIVATE_FILE_CHUNK_BYTES+111);
  bytes.set([0x50,0x4b,0x03,0x04],0);
  for(let i=4;i<bytes.length;i++)bytes[i]=i%251;
  const input=new File([bytes],'private-archive.zip',{
    type:'application/zip',lastModified:1700000000000
  });
  const progress=[];
  const entry=await store.importFile(input,(done,total)=>progress.push([done,total]));
  assert.equal(entry.size,bytes.length);
  assert.equal(entry.name,'private-archive.zip');
  assert.equal(progress.length,2);
  const restored=await store.readFile(entry.id);
  assert.equal(restored.name,input.name);
  assert.equal(restored.type,input.type);
  assert.equal(restored.size,input.size);
  assert.equal(restored.lastModified,input.lastModified);
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()),bytes);
  assert.equal((await store.list()).length,1);
  assert.match(await store.getUri(entry.id),/^file:\/\/\/LibraryNoCloud\//);
});

test('LocalFile validates ID, read limit and stored byte count',async()=>{
  const fs=fakeFilesystem();
  const store=createPrivateLocalStore(fs,'LIBRARY_NO_CLOUD');
  const entry=await store.importFile(new File(['test'],'notes.txt',{type:'text/plain'}));
  await assert.rejects(store.readFile('../private'),/無效的本機檔案 ID/);
  await assert.rejects(store.readFile(entry.id,{maxBytes:3}),/過大/);
  await assert.rejects(store.readFile(entry.id,{maxBytes:PRIVATE_FILE_READ_MAX_BYTES+1}),/讀取上限/);
  assert.equal(await store.preview(entry.id),'test');
  fs.files.set(privateFilePath(entry.id),Buffer.from('lost'));
  await assert.rejects(store.readFile(entry.id),/大小不一致/);
  await assert.rejects(store.preview(entry.id),/大小不一致/);
});

test('removal deletes device copy and index, not a remote database',async()=>{
  const fs=fakeFilesystem();
  const store=createPrivateLocalStore(fs,'LIBRARY_NO_CLOUD');
  const entry=await store.importFile(new File(['text'],'private.md'));
  await store.remove(entry.id);
  assert.deepEqual(await store.list(),[]);
  await assert.rejects(store.readFile(entry.id),/找不到本機檔案/);
  assert.equal(fs.files.has(privateFilePath(entry.id)),false);
});

test('damaged native index prevents any new file from being written',async()=>{
  const fs=fakeFilesystem();
  const store=createPrivateLocalStore(fs,'LIBRARY_NO_CLOUD');
  const entry=await store.importFile(new File(['original'],'first.md'));
  const index=[...fs.files.keys()].find(path=>path.endsWith('/index.json'));
  fs.files.set(index,Buffer.from('{invalid json','utf8'));
  await assert.rejects(store.importFile(new File(['new'],'second.md')),/索引 JSON 損壞/);
  assert.equal(fs.files.has(privateFilePath(entry.id)),true);
  assert.equal([...fs.files.keys()].filter(path=>path.endsWith('.bin')).length,1);
});
