'use client';
import useLocUser from './use-loc-user';
import {LOC_USER_DEFAULTS} from './loc-user-store.mjs';
// The existing OAuth user row is shared in the resource cache.
// Guests retain the original page defaults and never request private settings.
export default function useLocFeatureSettings(feature){
  const {data,ready}=useLocUser();
  return {settings:ready&&data?.[feature]||LOC_USER_DEFAULTS[feature],
    active:Boolean(ready&&data),keyword:ready?data.keyword:'none'};
}
