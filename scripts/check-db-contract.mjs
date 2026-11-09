import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';
import {scopeConfigColumns,scopeFeatureColumns,scopeFeaturePatch} from '../app/loc/scope-config-fields.mjs';

const read=relative=>readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const databaseContract='app/loc/db-contract.mjs';
const databaseClient='app/loc/db-client.mjs';

function functionsIn(source){
  return parse(source,{sourceType:'module'}).program.body
    .map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node)
    .filter(node=>node?.type==='FunctionDeclaration');
}
export function checkDbContract(contractSource,clientSource){
  const creator=functionsIn(contractSource).find(node=>node.id?.name==='createDatabaseClient');
  if(!creator)throw Error('Missing createDatabaseClient declaration');
  const defined=new Set();
  for(const param of creator.params){
    if(param.type==='Identifier')defined.add(param.name);
    else if(param.type==='ObjectPattern')
      for(const prop of param.properties)
        if(prop.type==='ObjectProperty'&&prop.value.type==='Identifier')defined.add(prop.value.name);
  }
  for(const node of creator.body.body){
    if(node.type==='FunctionDeclaration'&&node.id)defined.add(node.id.name);
    if(node.type==='VariableDeclaration')
      for(const declarator of node.declarations)
        if(declarator.id.type==='Identifier')defined.add(declarator.id.name);
  }
  const returned=creator.body.body.findLast(node=>node.type==='ReturnStatement')?.argument;
  if(!returned||returned.type!=='ObjectExpression')
    throw Error('Database contract must return an object');
  const exported=returned.properties.map(prop=>{
    if(prop.type!=='ObjectProperty'||prop.computed||prop.key.type!=='Identifier'||prop.value.type!=='Identifier')
      throw Error('Database contract exports must use static identifier references');
    return {name:prop.key.name,ref:prop.value.name};
  });
  const absent=exported.filter(item=>!defined.has(item.ref)).map(item=>item.name);
  if(absent.length)throw Error('DB contract exports undeclared bindings: '+absent.join(', '));
  const clientAst=parse(clientSource,{sourceType:'module'});
  const destructured=[];
  for(const node of clientAst.program.body){
    const decl=node.type==='ExportNamedDeclaration'?node.declaration:node;
    if(decl?.type!=='VariableDeclaration')continue;
    for(const binding of decl.declarations){
      if(binding.init?.type!=='Identifier'||binding.init.name!=='client'||binding.id.type!=='ObjectPattern')continue;
      for(const prop of binding.id.properties)
        if(prop.type==='ObjectProperty'&&prop.key.type==='Identifier')destructured.push(prop.key.name);
    }
  }
  const names=new Set(exported.map(item=>item.name));
  const missing=destructured.filter(name=>!names.has(name));
  if(missing.length)throw Error('DB client expects missing contract exports: '+missing.join(', '));
  return {exported:exported.length,consumed:destructured.length};
}


export function checkLocScopeBoundary(migrations=[]){
  if(scopeConfigColumns('loc')!=='id,display_name,locale'||
      scopeFeatureColumns('loc')!==''||
      Object.keys(scopeFeaturePatch('loc',{search_able:false,statistics_able:false,culture_able:false})).length)
    throw Error('LOC group config must not inherit Scope theme, search, or feature switches');
  const unsafe=/\b(?:insert\s+into|merge\s+into|alter\s+table|delete\s+from|drop\s+table|truncate(?:\s+table)?)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:"?silver"?\s*\.\s*)"?loc"?(?![\w])/i;
  // LOC is a Scope Group, but the explicitly approved global JSONB config
  // consolidation is not a Scope feature switch. Permit only these precise
  // column operations; all other LOC mutations remain prohibited.
  const approved=new Map([
    ['20261103001000_loc_jsonb_consolidation_stage1.sql',
      /^ALTER\s+TABLE\s+silver\.loc\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(?:caches|database|blacklist)\s+jsonb\b/i],
    ['20261103003000_loc_jsonb_drop_legacy.sql',
      /^ALTER\s+TABLE\s+silver\.loc\s+DROP\s+COLUMN\s+cache\s*$/i],
    ['20261103040000_loc_theme_keywords_jsonb_cutover.sql',
      /^ALTER\s+TABLE\s+silver\.loc\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(?:theme|keywords)\s+jsonb\b/i],
    // Authorized 2026-11-05 System/Group split; only these exact columns/
    // Group membership inserts. No RLS, policy or grant is allowlisted.
    ['20261105223000_split_manage_system_and_loc_scope_stage.sql',
      /\b(?:ALTER\s+TABLE\s+silver\.loc\s+(?:DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+loc_config_singleton|ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(?:title_tw|desc_tw|birthday))|INSERT\s+INTO\s+silver\.loc\s*\(id\b)/i],
    ['20261105230000_api_scope_registry_loc_group_writes.sql',
      /\bINSERT\s+INTO\s+silver\.loc\s*\(id\b/i],
    ['20261105231000_finish_manage_system_loc_group_cutover.sql',
      /\bALTER\s+TABLE\s+silver\.loc\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+(?:caches|database)\b/i],
    ['20261109093000_loc_source_article_tag_only.sql',
      /^ALTER\s+TABLE\s+silver\.loc\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+"DefaultArticleClass"\s*,\s*DROP\s+COLUMN\s+IF\s+EXISTS\s+blacklist$/i]
  ]);
  for(const [name,sql] of migrations){
    const allow=approved.get(name);
    for(const statement of sql.split(';')){
      const trimmed=statement.replace(/--[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'').trim();
      if(unsafe.test(trimmed)&&!(allow&&allow.test(trimmed)))
        throw Error('LOC group table is protected from migration writes or schema edits: '+name);
    }
  }
  return {checked:migrations.length};
}

// Build-time hard stop: neither production nor transitive dependency graph may
// reinstall a Supabase or Clerk SDK. Native LOC Auth and Kysely remain separate.
export function checkProhibitedVendorDependencies(packageJson,lockJson){
  const pkg=JSON.parse(packageJson),lock=JSON.parse(lockJson);
  const bad=name=>/^(?:@supabase\/|@clerk\/|supabase(?:-|$)|clerk(?:-|$))/i.test(name);
  const declared=Object.entries(pkg)
    .filter(([section])=>['dependencies','devDependencies','optionalDependencies','peerDependencies'].includes(section))
    .flatMap(([,dependencies])=>Object.keys(dependencies||{})).filter(bad);
  const installed=Object.keys(lock.packages||{})
    .filter(path=>/^(?:node_modules\/)(?:@supabase\/|@clerk\/|supabase(?:-|$)|clerk(?:-|$))/i.test(path));
  if(declared.length||installed.length)
    throw Error('Forbidden vendor Auth/Data SDK dependencies: '+[...declared,...installed].join(', '));
  return {declared:0,installed:0};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  checkProhibitedVendorDependencies(read('package.json'),read('package-lock.json'));
  const result=checkDbContract(read(databaseContract),read(databaseClient));
  const migrationDir=new URL('../supabase/migrations/',import.meta.url);
  const migrationFiles=readdirSync(migrationDir)
    .filter(name=>name.endsWith('.sql')&&name.slice(0,8)>='20261102')
    .map(name=>[name,read('supabase/migrations/'+name)]);
  const loc=checkLocScopeBoundary(migrationFiles);
  console.log('DB contract OK: '+result.exported+' exports, '+result.consumed+' consumers; LOC boundary checked '+loc.checked+' migrations.');
}
