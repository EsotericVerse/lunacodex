// Shared portable Kysely driver for the independent LOC SQL Gateway.
import {Kysely,PostgresDialect,MysqlDialect,MssqlDialect,ParseJSONResultsPlugin} from "npm:kysely@0.29.8";
import pg from "npm:pg@8.16.3";
import {normalizeDatabaseTarget} from "./selected-database-target.mjs";
import {mysqlLdapOptions,mssqlAuthentication} from "./sql-driver-auth.mjs";
import {PORTABLE_JSON_COLUMNS} from "./sql-engine-ports.mjs";

// All credentials stay in trusted Gateway secrets; clients see only aliases.
// LOC_DB_CONNECTIONS_JSON example:
// {"office_mysql":{"engine":"mysql","url":"mysql://user:pass@db.example:3306/silver","tls":true},
//  "office_mssql":{"engine":"mssql","url":"mssql://user:pass@db.example:1433/loc","tls":true}}
const instances=new Map<string, Kysely<Record<string,Record<string,unknown>>>>();
const trustedDialects=new WeakMap<object,unknown>();
// Reuse an existing LOC Kysely dialect/pool for ZenStack without a second connection.
export function trustedDialectForDatabase(db:object){
  const dialect=trustedDialects.get(db);
  if(!dialect)throw new Error('Unknown LOC Kysely database');
  return dialect;
}
const {Pool}=pg;
type ConnectionProfile={engine:string,url:string,tls?:boolean,
  authentication?:{type?:string,domain?:string,clientId?:string,
    clientSecret?:string,tenantId?:string,token?:string}};
function connectionProfiles():Record<string,ConnectionProfile>{
  const raw=Deno.env.get("LOC_DB_CONNECTIONS_JSON")||"{}";
  let json:unknown;
  try{json=JSON.parse(raw);}catch{throw new Error("Invalid LOC_DB_CONNECTIONS_JSON secret");}
  if(!json||typeof json!=="object"||Array.isArray(json))throw new Error("Invalid LOC_DB_CONNECTIONS_JSON secret");
  return json as Record<string,ConnectionProfile>;
}
export function resolveConnectionProfile(input:Record<string,unknown>):ConnectionProfile{
  const target=normalizeDatabaseTarget(input);
  const profile=connectionProfiles()[target.connection_alias];
  if(profile){
    if(!profile||typeof profile!=="object"||profile.engine!==target.engine||typeof profile.url!=="string"||!profile.url){
      throw new Error("Connection alias has an invalid or mismatched engine");
    }
    return profile;
  }
  throw new Error("Connection alias is not configured in LOC_DB_CONNECTIONS_JSON");
}
export async function databaseForTarget(input:Record<string,unknown>,options:{profileLookup?:(target:Record<string,unknown>)=>Promise<ConnectionProfile>}={}){
  const target=normalizeDatabaseTarget(input);
  const profile=options.profileLookup?await options.profileLookup(target):resolveConnectionProfile(target);
  const key=target.connection_alias+":"+target.engine+":"+profile.url;
  const cached=instances.get(key);
  if(cached)return cached;
  const uri=new URL(profile.url);
  if(!["postgres:","postgresql:","mysql:","mssql:","sqlserver:"].includes(uri.protocol))throw new Error("Invalid database URL protocol");
  let dialect;
  if(target.engine==="postgres"){
    if(!["postgres:","postgresql:"].includes(uri.protocol))throw new Error("PostgreSQL needs a postgres URL");
    // Pool sizing is independent of database hosting. A single trusted SQL
    // Gateway instance reuses this connection pool for its Scope queries.
    dialect=new PostgresDialect({pool:new Pool({connectionString:profile.url,
      max:1,idleTimeoutMillis:15000,connectionTimeoutMillis:7000})});
  }else if(target.engine==="mysql"){
    if(uri.protocol!=="mysql:")throw new Error("MySQL needs a mysql URL");
    const mysql=await import("npm:mysql2@3.22.0");
    const createPool=mysql.createPool||mysql.default?.createPool;
    if(typeof createPool!=="function")throw new Error("mysql2 driver is unavailable");
    dialect=new MysqlDialect({pool:createPool({
      host:uri.hostname,port:Number(uri.port)||3306,
      user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
      database:decodeURIComponent(uri.pathname.slice(1)),
      waitForConnections:true,connectionLimit:1,queueLimit:10,
      ...(profile.tls===false?{}:{ssl:{rejectUnauthorized:true}}),
      ...mysqlLdapOptions(profile)
    })});
  }else if(target.engine==="mssql"){
    if(!["mssql:","sqlserver:"].includes(uri.protocol))throw new Error("SQL Server needs a mssql URL");
    const Tedious=await import("npm:tedious@18.6.1");
    const Tarn=await import("npm:tarn@3.0.2");
    dialect=new MssqlDialect({
      tarn:{...Tarn,options:{min:0,max:1}},
      tedious:{...Tedious,connectionFactory:()=>new Tedious.Connection({
        server:uri.hostname,
        authentication:mssqlAuthentication(profile,
          decodeURIComponent(uri.username),decodeURIComponent(uri.password)) as
          ConstructorParameters<typeof Tedious.Connection>[0]['authentication'],
        options:{database:decodeURIComponent(uri.pathname.slice(1)),port:Number(uri.port)||1433,encrypt:profile.tls!==false,trustServerCertificate:false,connectTimeout:5000}
      })}
    });
  }else throw new Error("Selected database engine has no trusted server driver");
  const jsonColumns=new Set(PORTABLE_JSON_COLUMNS);
  const db=new Kysely<Record<string,Record<string,unknown>>>({dialect,
    // MS SQL Server returns JSON values as text. Use Kysely's official
    // result plugin, restricted to known JSON fields so lyrics/content
    // that happen to look like JSON are never parsed into objects.
    plugins:target.engine==="mssql"?[new ParseJSONResultsPlugin({
      shouldParse:(_value,path)=>{
        const column=path.split(/[.\[\]"]/).filter(Boolean).pop();
        return jsonColumns.has(column||"");
      }
    })]:[]
  });
  trustedDialects.set(db,dialect);
  instances.set(key,db);
  return db;
}
