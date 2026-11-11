// CI-only setup. NEVER create roles or rotate credentials in production.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
assert.equal(process.env.GITHUB_ACTIONS,'true','CI role setup may run only in Actions');
assert.equal(process.env.LOC_AUTH_SCHEMA_GENERATION,'1','Missing isolated test mode');
const url=new URL(process.env.LOC_AUTH_DATABASE_URL||'');
assert.equal(url.hostname,'127.0.0.1','CI role setup must use local PostgreSQL');
assert.equal(url.pathname,'/loc_auth_schema','CI role setup must use disposable test DB');
const pool=new Pool({connectionString:url.toString(),ssl:false,max:1});
try{
  await pool.query("CREATE ROLE loc_auth_ci LOGIN PASSWORD 'loc_auth_ci_only' NOSUPERUSER NOBYPASSRLS");
  await pool.query("CREATE ROLE loc_web_ci LOGIN PASSWORD 'loc_web_ci_only' NOSUPERUSER NOBYPASSRLS");
  await pool.query('GRANT CONNECT ON DATABASE loc_auth_schema TO loc_auth_ci');
  await pool.query('GRANT CONNECT ON DATABASE loc_auth_schema TO loc_web_ci');
}finally{
  await pool.end();
}
