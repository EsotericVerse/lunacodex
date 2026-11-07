// Virtual global identity for independent LOC data sources.
// Not a database column, connection secret, migration, or authorization grant.
// DB IDs are stable, non-secret registry identifiers, NOT connection strings.
// A physical Anchor/Galaxy UID is unique only inside (databaseId,scopeId).
const DATABASE_ID=/^[a-z][a-z0-9_-]{0,63}$/;
const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;

function identityPart(value,pattern,name){
  const text=String(value??'').trim();
  if(!pattern.test(text))throw new Error('Invalid LOC '+name);
  return text;
}
export function locGlobalUid({databaseId,scopeId,uid}={}){
  const db=identityPart(databaseId,DATABASE_ID,'database ID');
  const scope=identityPart(scopeId,SCOPE_ID,'Scope ID');
  const local=identityPart(uid,UID,'UID');
  return db+':'+scope+':'+local;
}
export function parseLocGlobalUid(key){
  const parts=String(key??'').split(':');
  if(parts.length!==3)throw new Error('Invalid LOC global UID');
  const [databaseId,scopeId,uid]=parts;
  if(locGlobalUid({databaseId,scopeId,uid})!==key)
    throw new Error('Invalid LOC global UID');
  return Object.freeze({databaseId,scopeId,uid});
}
export function locGlobalRowRef(row,context){
  const uid=identityPart(row?.uid,UID,'UID');
  return locGlobalUid({...context,uid});
}


/** Qualify local Anchor relationship records without changing physical UIDs.
 * Different databases with the same uid remain distinct. This is indexing
 * metadata, NOT an authorization decision or a database synchronization job.
 */
export function qualifyLocAnchorLinks(links,{databaseId,scopeId}={}){
  if(!Array.isArray(links))throw new Error('Invalid LOC Anchor link collection');
  return links.map(link=>{
    if(!link||typeof link!=='object'||
       !['keyword','source','time','space'].includes(link.family)||
       typeof link.fromType!=='string'||!link.fromType||
       typeof link.toType!=='string'||!link.toType||
       !['uid','period','path','point'].includes(link.attrKey)||
       typeof link.resolved!=='boolean')
      throw new Error('Invalid LOC Anchor link');
    return Object.freeze({
      ...link,
      from:locGlobalUid({databaseId,scopeId,uid:link.fromUid}),
      to:locGlobalUid({databaseId,scopeId,uid:link.toUid})
    });
  });
}
