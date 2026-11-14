'use client';
import {useCallback,useRef} from 'react';
import {usePassiveSessionAccount} from './use-account';
import {useAsyncResource} from '../../zenstack/client-queries';
import {loadOrCreateLocUser,saveLocUserField} from './loc-user-store.mjs';

// Shared per-OAuth ZenStack client resource. Guests make no request; a verified login
// supplies the account ID. No automatic INSERT and no second email check.
export default function useLocUser({verifiedSubject=''}={}){
  const account=usePassiveSessionAccount();
  // Settings can already have a server-verified OAuth identity even before
  // the passive SDK event hydrates the session navigation cache.
  const subject=String(verifiedSubject||account.user?.id||'');
  const email=String(account.email||account.user?.email||'').trim().toLowerCase();
  const enabled=Boolean(subject&&email)&&(!account.loading||Boolean(verifiedSubject));
  const key=enabled?['loc-user',subject,email]:null;
  const query=useAsyncResource({
    queryKey:key,enabled,queryFn:()=>loadOrCreateLocUser(email),
    revalidateOnFocus:false,revalidateOnReconnect:false,revalidateIfStale:false
  });
  const queue=useRef(Promise.resolve());
  const update=useCallback((field,value)=>{
    if(!enabled||!query.isSuccess||!query.data)
      return Promise.reject(new Error('OAuth 個人設定尚未載入'));
    const uid=query.data.uid||'';
    // A fast series of choices must be committed in order. No mutation is
    // sent under another user's cache key if OAuth changes mid-flight.
    const request=queue.current.catch(()=>{}).then(async()=>{
      const saved=await saveLocUserField(uid,field,value,email);
      await query.mutate(saved,{revalidate:false});
      return saved;
    });
    queue.current=request;
    return request;
  },[enabled,email,query.isSuccess,query.data?.uid,query.mutate]);
  return {
    data:enabled?query.data:null,
    ready:enabled&&query.isSuccess,
    loading:enabled&&query.isLoading,
    error:enabled?query.error:null,
    authenticated:enabled,
    update,refresh:query.refetch
  };
}
