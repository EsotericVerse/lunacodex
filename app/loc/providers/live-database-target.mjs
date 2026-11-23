// Trusted runtime SQL target selection. No runtime schema changes, browser
// credentials or deployment-time dialect lock-in. Profiles originate ONLY from
// the encrypted LOC Authority, never from request body parameters.
import {normalizeSqlDriverAuthentication,sqlAuthNeedsUserPassword}
 from './sql-driver-auth.mjs';
import {getSqlType} from '../../../modules/loc/dialect/index.mjs';
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const HOST=/^[a-z0-9.-]{1,253}$/;
const NAME=/^[A-Za-z0-9_-]{1,120}$/;
export function normalizeLiveTarget(id,profile){
 if(!ID.test(String(id||'')))throw Error('Invalid selected database ID');
 if(!profile||typeof profile!=='object'||Array.isArray(profile))
  throw Error('LOC database profile is not configured');
 const engine=String(profile.engine||'');
 // Engine is an explicit trusted setting; never infer it from a URI,
 // the database vendor, a failed query, or another configured target.
 let type;
 try{type=getSqlType(engine);}
 catch{throw Error('Unsupported runtime SQL engine');}
 const port=Number(profile.port);
 const host=String(profile.host||'').toLowerCase();
 const database=String(profile.database||'');
 const authentication=normalizeSqlDriverAuthentication(engine,profile.authentication);
 const needsPassword=sqlAuthNeedsUserPassword(authentication);
 // All three currently supported driver authentication modes require
 // server-owned user credentials. Unrecognized auth modes fail closed.
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
 // A normalized URL represents the trusted target identity, not an active
 // driver connection. SQL Server's Tedious driver consumes typed options,
 // not a raw URL, when the verified target is actually opened.
 const protocol=type.protocol;
 const url=new URL(protocol+'://example.invalid');
 // WHATWG URL credentials setters do not encode bare percent signs.
 // Explicit component encoding also protects +, / and @ in server-owned
 // credentials; the trusted driver decodes exactly once.
 url.hostname=host;url.port=String(port);
 url.username=encodeURIComponent(username);
 url.password=encodeURIComponent(password);
 url.pathname='/'+encodeURIComponent(database);
 const chosenSchema=String(profile.schema_name||'');
 // MySQL's database is its namespace. Supplying a different schema here
 // would make an implicit cross-database read, so never ignore that input.
 if(type.namespace==='database'&&chosenSchema&&chosenSchema!==database)
   throw Error('MySQL namespace must equal the selected database');
 const namespace=type.namespace==='database'?'':chosenSchema||
   type.targetNamespace;
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
  // This profile remains server-only. The browser receives neither the URI
  // nor driver settings; the actual connection requires a verified LOC
  // Authority target and an installed trusted driver.
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

// The fixed LOC control registry is in the selected PostgreSQL database.
export function registryRelationForEngine(engine){
 if(engine==='postgres')return 'api.manage';
 throw Error('Unsupported main SQL engine');
}
