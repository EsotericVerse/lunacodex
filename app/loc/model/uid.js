// Pure cryptographic UID generators for both browser and trusted Kysely writers.

const UID_ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function createUid8(){
  const bytes=new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes,value=>UID_ALPHABET[value%UID_ALPHABET.length]).join('');
}

// Canonical Anchor UID: eight case-sensitive Base62 characters.
const BASE62='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function allocateAnchorUid(assigned=new Set()){
  const random=globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if(!random)throw Error('Secure UID generator unavailable');
  for(let attempt=0;attempt<128;attempt++){
    const bytes=random(new Uint8Array(16));
    let uid='';
    for(const byte of bytes){
      if(byte>=248)continue;
      uid+=BASE62[byte%62];
      if(uid.length===8)break;
    }
    if(uid.length===8&&!assigned.has(uid))return uid;
  }
  throw Error('Cannot allocate a unique Anchor UID');
}
