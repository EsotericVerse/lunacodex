// Trusted runtime SQL target selection. No runtime schema changes, browser
// credentials or deployment-time dialect lock-in. Profiles originate ONLY from
// the encrypted LOC Authority, never from request body parameters.
import {normalizeSqlDriverAuthentication,sqlAuthNeedsUserPassword}
 from './sql-driver-auth.mjs';
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const ENGINES=new Set(['postgres','mysql','mssql']);
const HOST=/^[a-z0-9.-]{1,253}$/;
const NAME=/^[A-Za-z0-9_-]{1,120}$/;
export function normalizeLiveTarget(id,profile){
 if(!ID.test(String(id||'')))throw Error('Invalid selected database ID');
 if(!profile||typeof profile!=='object'||Array.isArray(profile))
  throw Error('LOC database profile is not configured');
 const engine=String(profile.engine||'');
 if(!ENGINES.has(engine))throw Error('Unsupported runtime SQL engine');
 const port=Number(profile.port);
 const host=String(profile.host||'').toLowerCase();
 const database=String(profile.database||'');
 const authentication=normalizeSqlDriverAuthentication(engine,profile.authentication);
 const needsPassword=sqlAuthNeedsUserPassword(authentication);
 // Passwordless Entra identities and signed access-token authentication do
 // not have a SQL username/password. All other modes fail closed if missing.
 if(needsPassword&&
   (typeof profile.username!=='string'||typeof profile.password!=='string'))
  throw Error('Trusted runtime SQL credentials are missing');
 const username=typeof profile.username==='string'?profile.username:'';
 const password=typeof profile.password==='string'?profile.password:'';
 if(!HOST.test(host)||host.startsWith('.')||host.endsWith('.')||
  !Number.isInteger(port)||port<1||port>65535||
  !NAME.test(database)||(needsPassword&&!username.trim())||
  username.length>120||(needsPassword&&!password)||password.length>4096)
  throw Error('Trusted runtime SQL connection is incomplete');
 const protocol=engine==='mssql'?'mssql':engine==='mysql'?'mysql':'postgres';
 const url=new URL(protocol+'://example.invalid');
 url.hostname=host;url.port=String(port);url.username=username;
 url.password=password;url.pathname='/'+encodeURIComponent(database);
 const namespace=engine==='mysql'?'':String(profile.schema_name||
   (engine==='mssql'?'dbo':'silver'));
 const safe=/^[A-Za-z][A-Za-z0-9_]{0,119}$/;
 const table=String(profile.table_name||'');
 const fieldMap=profile.field_map||{};
 if(namespace&&!safe.test(namespace)||table&&!safe.test(table)||
   !fieldMap||typeof fieldMap!=='object'||Array.isArray(fieldMap)||
   Object.keys(fieldMap).length>32||Object.entries(fieldMap).some(([k,v])=>
      !safe.test(k)||typeof v!=='string'||!safe.test(v)))
   throw Error('Trusted SQL relation mapping invalid');
 return {
  target:{provider:'custom',engine,connection_alias:id,connection_mode:'direct',
   ...(namespace?{schema_name:namespace}:{}),
   ...(table?{table_name:table}:{}),field_map:fieldMap},
  profile:{engine,url:url.href,tls:true,authentication}
 };
}
export function runtimeTargetId(claims){
 const id=claims?.db_target;
 if(id===undefined||id===null)return null;
 if(typeof id!=='string'||!ID.test(id))
  throw Error('Invalid LOC-authorized database selection');
 return id;
}
