// Dedicated Channel 1 receiver: explicit LOC connection alias, no vendor URL.
const alias=String(Deno.env.get('LOC_CHANNEL1_DB_ALIAS')||'');
if(!/^[a-z][a-z0-9_]{0,63}$/.test(alias))
 throw Error('LOC Channel 1 database alias is required');
let profiles:Record<string,{engine?:string,url?:string}>;
try{profiles=JSON.parse(Deno.env.get('LOC_DB_CONNECTIONS_JSON')||'{}');}
catch{throw Error('Invalid LOC SQL connection configuration');}
if(!profiles||Array.isArray(profiles)||typeof profiles!=='object'||
 profiles[alias]?.engine!=='postgres'||!profiles[alias]?.url)
 throw Error('LOC Channel 1 PostgreSQL connection is unavailable');
await import('../../app/loc/gateway/channel1-receiver.ts');
