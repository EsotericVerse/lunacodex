'use client';
import LocalScopeWorkspace from './LocalScopeWorkspace';
// The original "My Phone" entry and /local/ share the same Galaxy database,
// the same Extension Hero image and the same import/export controls.
export default function MyPhoneHome(){
  return <LocalScopeWorkspace view="home"/>;
}
