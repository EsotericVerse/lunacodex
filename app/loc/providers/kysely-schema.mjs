import {sql} from 'npm:kysely@0.29.8';
import {portableRelation} from './sql-engine-ports.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const FLAGS=['statics','culture','search','trace','list','keyword','extract','others'];
const effectiveNamespace=(engine,namespace)=>
  namespace||(engine==='mssql'?'dbo':'public');

/**
 * The only required per-Scope SQL relations. No stored procedures, DB auth
 * accounts, triggers, or LOC control tables are created in the user's DB.
 * The existing tables are never modified by this installer.
 */
export async function ensurePortableScopeSchema(db,{engine,namespace='',scopeId}={}){
  if(!SCOPE.test(String(scopeId||''))||!['postgres','mysql','mssql'].includes(engine))
    throw new Error('Invalid portable LOC Scope or SQL engine');
  const scope=scopeId;
  const schema=effectiveNamespace(engine,namespace);
  const meta=await db.introspection.getTables();
  const existing=new Set(meta.filter(row=>
    engine==='mysql'||!row.schema||row.schema===schema)
    .map(row=>row.name));
  const textType=engine==='mssql'?sql.raw('nvarchar(max)'):'text';
  const jsonType=engine==='postgres'?'jsonb':engine==='mysql'?'json':sql.raw('nvarchar(max)');
  const dateTimeType=engine==='postgres'?'timestamptz':
    engine==='mssql'?'datetime2':'datetime';
  const boolType=engine==='mssql'?'bit':'boolean';
  const uidType=engine==='mssql'
    ?sql.raw('varchar(8) COLLATE Latin1_General_100_BIN2'):'varchar(8)';
  const created=[];
  const createTable=name=>{
    let builder=db.schema.createTable(portableRelation(name,engine,namespace));
    if(engine!=='mssql')builder=builder.ifNotExists();
    return builder;
  };
  const finalize=async(builder,name,indexColumn)=>{
    if(engine==='mysql')builder=builder.modifyEnd(
      sql.raw('CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'));
    await builder.execute();
    await db.schema.createIndex(scope+'_'+indexColumn+'_idx')
      .on(portableRelation(name,engine,namespace)).column(indexColumn).execute();
    created.push(name);
  };
  if(!existing.has(scope+'_galaxy')){
    let q=createTable(scope+'_galaxy')
      .addColumn('uid',uidType,c=>c.primaryKey().notNull())
      .addColumn('title',textType)
      .addColumn('content',textType)
      .addColumn('createtime',dateTimeType)
      .addColumn('location',textType)
      .addColumn('UpdateTime',dateTimeType,c=>c.notNull().defaultTo(sql.raw('CURRENT_TIMESTAMP')))
      .addColumn('url',textType)
      .addColumn('source_id',uidType)
      .addColumn('target_id',engine==='postgres'?sql.raw('text[]'):jsonType)
      .addColumn('ref_id',uidType)
      .addColumn('site',textType)
      .addColumn('place_id',uidType)
      .addColumn('media_link',engine==='postgres'?sql.raw('varchar[]'):jsonType)
      .addColumn('date','date')
      .addColumn('site_id',textType);
    for(const flag of FLAGS)
      q=q.addColumn(flag,boolType,c=>c.notNull().defaultTo(true));
    await finalize(q,scope+'_galaxy','date');
  }
  if(!existing.has(scope+'_anchor')){
    let q=createTable(scope+'_anchor')
      .addColumn('uid',uidType,c=>c.primaryKey().notNull())
      .addColumn('type','varchar(16)',c=>c.notNull())
      .addColumn('title',textType)
      .addColumn('description',textType)
      .addColumn('invisible',boolType,c=>c.notNull().defaultTo(false))
      .addColumn('attr',jsonType,c=>c.notNull())
      .addColumn('createtime',dateTimeType,c=>c.defaultTo(sql.raw('CURRENT_TIMESTAMP')));
    await finalize(q,scope+'_anchor','type');
  }
  return {created};
}


// A matching table name is not enough: validate once at onboarding instead
// of letting every feature fail independently on a missing SQL column.
export function validatePortableScopeSchema(tables,{engine,namespace='',scopeId}={}){
  if(!SCOPE.test(String(scopeId||''))||!['postgres','mysql','mssql'].includes(engine))
    throw new Error('Invalid portable LOC Scope');
  const schema=effectiveNamespace(engine,namespace);
  const expected={
    galaxy:['uid','title','content','createtime','location','UpdateTime','url',
      'source_id','target_id','ref_id','site','place_id','media_link','date','site_id',
      ...FLAGS],
    // All portable Anchor relations must expose the physical creation time.
    // Existing databases need the additive, non-destructive Anchor migration.
    anchor:['uid','type','title','description','invisible','attr','createtime']
  };
  const names={scopeId};
  for(const [kind,columns] of Object.entries(expected)){
    const name=scopeId+'_'+kind;
    const table=tables.find(t=>t.name===name&&
      (engine==='mysql'||!t.schema||t.schema===schema));
    if(!table)throw new Error('Missing LOC table: '+name);
    const present=new Set((table.columns||[]).map(c=>c.name));
    const missing=columns.filter(col=>!present.has(col));
    if(missing.length)throw new Error('LOC table '+name+' has missing columns: '+missing.join(', '));
    names[kind]=portableRelation(name,engine,namespace);
  }
  return names;
}
