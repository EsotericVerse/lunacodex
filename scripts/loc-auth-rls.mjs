// LOC Auth database access isolation. Run only AFTER Better Auth's own migrations
// from the trusted one-time migration command; never from an HTTP request.
// The Auth runtime role may access Auth tables, but never owns them or BYPASSes RLS.
import assert from 'node:assert/strict';

const SCHEMA='loc_auth';
const POLICY='loc_auth_runtime';
const NAME=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const quote=name=>{
  if(!NAME.test(String(name)))throw new Error('Invalid PostgreSQL identifier');
  return '"'+name+'"';
};

// Run before vendor DDL too: no Auth schema may be initialized without a
// separate non-bypass runtime role ready to receive the mandatory policies.
export async function assertLocAuthRuntimeRole(pool,runtimeRole){
  const role=String(runtimeRole||'');
  if(!NAME.test(role))throw new Error('LOC Auth dedicated runtime role is required');
  const {rows}=await pool.query(
    'SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=$1',
    [role]);
  assert.equal(rows.length,1,'Dedicated LOC Auth runtime role must exist first');
  assert.equal(rows[0].rolsuper,false,'Auth runtime must not be superuser');
  assert.equal(rows[0].rolbypassrls,false,'Auth runtime must not bypass RLS');
  assert.equal(rows[0].rolcanlogin,true,'Auth runtime must be login-enabled');
  const {rows:owner}=await pool.query('SELECT current_user AS role');
  assert.notEqual(owner[0].role,role,
    'Runtime role and migration owner must be distinct');
  return role;
}

export async function applyLocAuthRls(pool,runtimeRole){
  const role=String(runtimeRole||'');
  if(!NAME.test(role))throw new Error('LOC Auth dedicated runtime role is required');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const roles=await client.query(
      'SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=$1',
      [role]);
    assert.equal(roles.rowCount,1,'Dedicated LOC Auth runtime role must exist before migration');
    const r=roles.rows[0];
    assert.equal(r.rolsuper,false,'Auth runtime must not be a PostgreSQL superuser');
    assert.equal(r.rolbypassrls,false,'Auth runtime must not have BYPASSRLS');
    assert.equal(r.rolcanlogin,true,'Auth runtime must be a real login role');
    const {rows:current}=await client.query('SELECT current_user AS name');
    assert.notEqual(current[0].name,role,'Runtime and migration owner must be different roles');
    const {rows:tables}=await client.query(
      `SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relkind IN ('r','p')
       ORDER BY c.relname`,[SCHEMA]);
    const models=tables.map(t=>t.name);
    for(const model of ['user','session','account','verification'])
      assert.ok(models.includes(model),'Missing Better Auth core table: '+model);
    for(const t of tables)
      assert.notEqual(t.owner,role,'Auth runtime must not own '+t.name);
    await client.query('REVOKE ALL ON SCHEMA '+quote(SCHEMA)+' FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA '+quote(SCHEMA)+' TO '+quote(role));
    await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA '+quote(SCHEMA)+' FROM PUBLIC');
    await client.query('REVOKE ALL ON ALL SEQUENCES IN SCHEMA '+quote(SCHEMA)+' FROM PUBLIC');
    for(const t of tables){
      const relation=quote(SCHEMA)+'.'+quote(t.name);
      const existing=await client.query(
        'SELECT policyname FROM pg_policies WHERE schemaname=$1 AND tablename=$2',
        [SCHEMA,t.name]);
      if(existing.rows.some(p=>p.policyname!==POLICY))
        throw new Error('Unexpected additional Auth RLS policy on '+t.name);
      await client.query('ALTER TABLE '+relation+' ENABLE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE '+relation+' FORCE ROW LEVEL SECURITY');
      if(existing.rowCount===0)
        await client.query('CREATE POLICY '+quote(POLICY)+' ON '+relation+
          ' FOR ALL TO '+quote(role)+' USING (true) WITH CHECK (true)');
      else
        await client.query('ALTER POLICY '+quote(POLICY)+' ON '+relation+
          ' TO '+quote(role)+' USING (true) WITH CHECK (true)');
    }
    await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA '+
      quote(SCHEMA)+' TO '+quote(role));
    await client.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA '+
      quote(SCHEMA)+' TO '+quote(role));
    // Fail closed: check every table, not only the four Better Auth core tables.
    await verifyLocAuthRls(client,role,models);
    await client.query('COMMIT');
    return models;
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}

export async function verifyLocAuthRls(client,role,expectedNames=null){
  const result=await client.query(
    `SELECT c.relname AS name,c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced,
            pg_get_userbyid(c.relowner) AS owner
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relkind IN ('r','p') ORDER BY c.relname`,
    [SCHEMA]);
  if(expectedNames)assert.deepEqual(
    result.rows.map(t=>t.name),[...expectedNames].sort());
  for(const table of result.rows){
    assert.equal(table.enabled,true,'RLS disabled on '+table.name);
    assert.equal(table.forced,true,'FORCE RLS missing on '+table.name);
    assert.notEqual(table.owner,role,'Auth runtime owns '+table.name);
    const policies=await client.query(
      'SELECT policyname,roles,cmd,qual,with_check FROM pg_policies '+
      'WHERE schemaname=$1 AND tablename=$2',[SCHEMA,table.name]);
    assert.equal(policies.rowCount,1,'Expected exactly one RLS policy for '+table.name);
    const p=policies.rows[0];
    assert.equal(p.policyname,POLICY);
    assert.deepEqual(p.roles,[role]);
    assert.equal(p.cmd,'ALL');
    assert.equal(p.qual,'true');
    assert.equal(p.with_check,'true');
  }
  return result.rows.map(row=>row.name);
}
