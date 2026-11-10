'use client';
import useLocUser from './use-loc-user';

// Mounted once by AppShell, after shared query/LOC Auth initialization. It performs no
// request for Guest and does not mount any Culture/Statistics/Trace/Search UI.
export default function LocUserBootstrap(){
  useLocUser();
  return null;
}
