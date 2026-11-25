import {sql} from 'kysely';
const IDENT=/^[a-z][a-z0-9_]{0,62}$/;
// No extra query on a healthy read. A missing expected Galaxy is normal only
// after the connected database confirms that the schema exists and table does not.
export function isMissingGalaxyRelation(error,scope,namespace='silver'){
  if(typeof scope!=='string'||typeof namespace!=='string'||
    !IDENT.test(scope)||!IDENT.test(namespace)||scope==='loc'||scope==='admin')return false;
  if(error?.httpStatus===401||error?.httpStatus===403||error?.code!=='42P01')return false;
  const table=scope+'_galaxy';
  const match=/^relation "([^"]+)" does not exist$/.exec(String(error.message||''));
  return Boolean(match&&(match[1]===namespace+'.'+table||match[1]===table));
}
export async function withOptionalGalaxy(db,scope,read,empty,{
  namespace='silver',engine='postgres',
  inspect=async()=>(await sql`select to_regnamespace(${namespace}) is not null as schema_present,
    to_regclass(${namespace+'.'+scope+'_galaxy'}) is not null as table_present`.execute(db)).rows[0]
}={}){
  try{return await read();}
  catch(error){
    if(engine!=='postgres'||!isMissingGalaxyRelation(error,scope,namespace))throw error;
    const state=await inspect();
    if(state?.schema_present!==true||state.table_present!==false)throw error;
    return empty();
  }
}
