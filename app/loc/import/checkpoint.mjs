// Durable, bounded receipts for confirmed import batches. This is NOT a
// row-skipping cursor or a SQL SAVEPOINT: a resumed import must still compare
// live Galaxy UIDs and related records before writing anything.
import * as z from 'zod';

const VERSION=1;
const MAX_AGE_MS=30*24*60*60*1000;
const fileSchema=z.strictObject({
  name:z.string().min(1),
  size:z.number().int().nonnegative(),
  lastModified:z.number().int().nonnegative()
});
const receiptSchema=z.strictObject({
  version:z.literal(VERSION),
  file:fileSchema,
  phase:z.enum(['update','insert','media']),
  confirmed:z.number().int().nonnegative(),
  total:z.number().int().nonnegative(),
  inserted:z.number().int().nonnegative(),
  conflicts:z.number().int().nonnegative(),
  savedAt:z.number().int().nonnegative()
});

function key(scopeId,ownerId){
  const scope=String(scopeId||'').trim();
  const owner=String(ownerId||'').trim();
  if(!scope||!owner)return '';
  return 'loc-import-receipt-v1:'+encodeURIComponent(owner)+':'+encodeURIComponent(scope);
}
function fingerprint(file){
  if(!file?.name)return null;
  const record={
    name:String(file.name),size:Number(file.size),
    lastModified:Number(file.lastModified||0)
  };
  return fileSchema.safeParse(record).success?record:null;
}
function matched(a,b){
  return a?.name===b?.name&&a?.size===b?.size&&
    a?.lastModified===b?.lastModified;
}
export function readImportCheckpoint(storage,{scopeId,ownerId,file,now=Date.now()}={}){
  const name=key(scopeId,ownerId),id=fingerprint(file);
  if(!name||!id||!storage)return null;
  try{
    const raw=storage.getItem(name);
    if(!raw)return null;
    const parsed=receiptSchema.safeParse(JSON.parse(raw));
    if(!parsed.success||parsed.data.savedAt>now||
       now-parsed.data.savedAt>MAX_AGE_MS){
      storage.removeItem(name);
      return null;
    }
    return matched(parsed.data.file,id)?parsed.data:null;
  }catch{return null;}
}
export function writeImportCheckpoint(storage,{scopeId,ownerId,file,phase,
  confirmed,total,inserted=0,conflicts=0,now=Date.now()}={}){
  const name=key(scopeId,ownerId),id=fingerprint(file);
  if(!name||!id||!storage)return null;
  const receipt={
    version:VERSION,file:id,phase,confirmed,total,inserted,conflicts,savedAt:now
  };
  const parsed=receiptSchema.safeParse(receipt);
  if(!parsed.success||confirmed>total)return null;
  try{
    storage.setItem(name,JSON.stringify(receipt));
    return receipt;
  }catch{return null;}
}
export function clearImportCheckpoint(storage,{scopeId,ownerId,file}={}){
  const name=key(scopeId,ownerId);
  if(!name||!storage||!file)return false;
  try{
    // A successful different file must never erase another pending receipt.
    if(!readImportCheckpoint(storage,{scopeId,ownerId,file}))return false;
    storage.removeItem(name);
    return true;
  }catch{return false;}
}
