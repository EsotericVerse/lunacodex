// Single Source ZModel owner/reader/writer shared by LOC native Pages and
// other Kysely application runtimes. Uses existing Anchor and LOC tables only.
// The verified LOC session MUST already be bound to the transaction by caller.
import {sql} from 'kysely';
import {canManageLoc} from './providers/loc-authorization.mjs';
import {indexZModelAnchorHierarchy} from '../../zenstack/anchor-hierarchy.mjs';
import {sourceTreeFromCatalog} from './source-classification.mjs';
import {allocateAnchorUid} from './unified-anchor-compat.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
function reject(message,status=400){
  throw Object.assign(new Error(message),{httpStatus:status});
}
function validScope(value){
  const id=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(id))reject('Invalid Scope ID');
  return id;
}

const sourceUidList=row=>Array.isArray(row?.attr?.uid)?row.attr.uid:[];
const sourceNames=value=>{
  if(typeof value==='string'){try{value=JSON.parse(value)}catch{return []}}
  return Array.isArray(value)?value.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()):[];
};
async function sourceMemberScopes(trx,viewer){
  if(viewer!=='loc')return [viewer];
  const records=await trx.selectFrom('api.manage').select('id')
    .where('parent_scope_id','=','loc').where('manage_role','=','scope')
    .where('active','=',true).orderBy('sort_order','asc').orderBy('id','asc').execute();
  return records.map(row=>row.id).filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id));
}
export async function sourceCatalogAction(trx,args,save=false){
  const viewer=validScope(args.p_scope_id);
  const group=viewer==='loc';
  if(!(await canManageLoc(trx,group?'group':'scope',viewer)))
    reject('Source catalog permission denied',403);
  // The caller never provides a target sibling Scope. Even LOC has no
  // permission to save a member's Domain/From catalogue through this action.
  if(save&&group)reject('LOC cannot edit child Scope sources',403);
  const scopes=await sourceMemberScopes(trx,viewer);
  await sql`reset role`.execute(trx);
  if(save){
    const entries=args.p_sources;
    if(!Array.isArray(entries)||entries.length>400||
       entries.some(v=>!v||typeof v!=='object'||Array.isArray(v)||
         Object.keys(v).some(k=>!['uid','name','label'].includes(k))||
         typeof v.name!=='string'||!v.name.trim()||v.name.trim().length>80||
         v.label!==undefined&&(typeof v.label!=='string'||v.label.trim().length>80)||
         v.uid!==undefined&&!UID.test(String(v.uid))))
      reject('Invalid source names');
    const names=entries.map(item=>item.name.trim());
    if(new Set(names.map(n=>n.normalize('NFKC').toLowerCase())).size!==names.length)
      reject('Duplicate source names');
    const anchor='silver.'+viewer+'_anchor';
    await sql`select pg_advisory_xact_lock(hashtext(${viewer}),hashtext('source-anchor'))`.execute(trx);
    const existing=await trx.selectFrom(anchor).select(['uid','type','title','attr'])
      .where('type','in',['domain','from']).execute();
    const domains=existing.filter(row=>row.type==='domain'&&row.title===viewer);
    if(domains.length>1)reject('Duplicate Scope source Domain');
    const current=domains[0]||null,owned=new Set(sourceUidList(current));
    const oldFrom=new Map(existing.filter(row=>row.type==='from'&&owned.has(row.uid))
      .map(row=>[row.uid,row]));
    if(owned.size!==oldFrom.size)reject('Broken source hierarchy references');
    // Keep source edits bounded: never scan the full Anchor table for a new UID.
    // The physical UID primary key remains the final collision guard.
    const assigned=new Set(existing.map(row=>row.uid));
    const next=[];
    for(const item of entries){
      const name=item.name.trim(),label=String(item.label||name).trim();
      let uid=item.uid;
      if(uid&&!owned.has(uid))reject('Cannot edit a foreign source UID',403);
      if(uid&&!oldFrom.has(uid))reject('Source UID does not belong to Domain');
      if(uid){
        // From title is the Galaxy.site comparison key, never a mutable label.
        if(oldFrom.get(uid).title!==name)reject('Source site key is immutable; use source correction',409);
        if((oldFrom.get(uid).description||name)!==label)
          await trx.updateTable(anchor).set({description:label===name?null:label})
            .where('uid','=',uid).where('type','=','from').execute();
      }else{
        uid=allocateAnchorUid(assigned);assigned.add(uid);
        await trx.insertInto(anchor).values({uid,type:'from',title:name,
          description:label===name?null:label,invisible:false,attr:sql`'{}'::jsonb`}).execute();
      }
      next.push(uid);
    }
    if(new Set(next).size!==next.length)reject('Duplicate source UID');
    if(!current){
      const uid=allocateAnchorUid(assigned);
      await trx.insertInto(anchor).values({uid,type:'domain',title:viewer,
        description:null,invisible:false,attr:sql`${JSON.stringify({uid:next})}::jsonb`}).execute();
    }else{
      await trx.updateTable(anchor).set({attr:sql`${JSON.stringify({uid:next})}::jsonb`})
        .where('uid','=',current.uid).where('type','=','domain').execute();
    }
    const removed=[...owned].filter(uid=>!next.includes(uid));
    if(removed.length)await trx.deleteFrom(anchor).where('type','=','from')
      .where('uid','in',removed).execute();
    return {count:next.length,removed:removed.length};
  }
  const global=await trx.selectFrom('silver.loc').select('DefaultArticleClass')
    .where('id','=','loc').executeTakeFirst();
  const system=sourceNames(global?.DefaultArticleClass);
  const records=[];
  for(const id of scopes){
    const registry=await trx.selectFrom('api.manage').select(['id','manage_role','anchor_table'])
      .where('id','=',id).where('manage_role','=','scope').where('active','=',true)
      .executeTakeFirst();
    if(!registry)continue;
    const suffix=String(registry.anchor_table||'anchor');
    if(!/^[a-z][a-z0-9_]*$/.test(suffix))reject('Invalid source Anchor mapping');
    const anchor='silver.'+id+'_'+suffix;
    const rows=await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
      .where('type','in',['domain','from']).execute();
    const domains=rows.filter(row=>row.type==='domain'&&row.title===id);
    if(domains.length>1)reject('Duplicate source Domain');
    // Use the already-defined ZModel Source hierarchy over the authorized
    // Domain/From rows. Universe/Galaxy remain presentation parents until
    // their physical Anchor nodes exist; do not fabricate local UIDs.
    const sourceGraph=indexZModelAnchorHierarchy(rows,{family:'source'});
    const domain=domains[0]||null;
    if(domain&&sourceGraph.descendants(domain.uid).missing.length)
      reject('Source Domain references missing From');
    const linked=domain?sourceGraph.childrenOf(domain.uid):[];
    const byUid=new Map(rows.filter(row=>row.type==='from').map(row=>[row.uid,row]));
    const sources=linked.map(uid=>byUid.get(uid));
    if(sources.some(item=>!item))reject('Source Domain references missing From');
    records.push({scopeid:id,domain:domain?{uid:domain.uid,title:domain.title}:null,
      sources:sources.map(row=>({uid:row.uid,name:row.title,label:row.description||row.title}))});
  }
  // Join only presentation metadata across Scope partitions. Persisted
  // Domain/From UIDs stay local to their owning Scope; unpersisted loc
  // Universe/Galaxy/Default nodes have stable UI keys, not fake Anchor UIDs.
  const tree=sourceTreeFromCatalog(system,[],{scopeId:'loc'});
  const galaxyNode=tree.find(node=>node.type==='galaxy');
  for(const record of records){
    const branch=sourceTreeFromCatalog([],record.sources,{
      scopeId:record.scopeid,domainUid:record.domain?.uid||'',includeSystem:false
    });
    const sourceDomain=branch.find(node=>node.type==='domain');
    if(!sourceDomain)continue;
    galaxyNode.children.push(sourceDomain.key);
    tree.push(...branch.filter(node=>node.type==='domain'||node.type==='from'));
  }
  return {universe:'loc',galaxy:'loc',system,scopes:records,tree};
}

