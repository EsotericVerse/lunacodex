import {ANCHOR_TYPE_GROUPS,indexZModelAnchorHierarchy} from '../../zenstack/anchor-hierarchy.mjs';

// Public SiteAnchor projection. The ZModel graph owns parent/child semantics.
export const classNames=values=>[...new Set((Array.isArray(values)?values:[]).map(x=>String(x??'').trim()).filter(Boolean))];
const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export function sourceSiteKeyForLabel(value){
 const s=norm(value);return s==='其他'||s==='others'?'others':s.match(/[a-z][a-z0-9_-]{2,}$/)?.[0]||s;
}
export function sourceLabelMatchesSite(site,label){
 const a=norm(site),b=norm(label);
 return Boolean(a&&b&&(a===b||sourceSiteKeyForLabel(b)===a));
}
export function sourceTaxonomyFromArrays(tags=[]){
 const names=classNames(tags).filter(s=>!['others','其他'].includes(norm(s)));
 names.push('Others');
 return {categories:names.map(name=>({category_code:norm(name),display_name:name,enabled:true})),
  aliases:names.map(name=>({source_key:norm(name),category_code:norm(name)})),
  groups:[],groupAliases:[],tree:[]};
}
export const sourceTaxonomyFromCatalog=tags=>sourceTaxonomyFromArrays(tags);

// The source taxonomy is the existing LocAnchor ZModel, not ArticleTag or a
// second media/platform registry. Anchor attr.uid is the only hierarchy link.
// Never derive parenthood from matching display titles.
const SOURCE_LEVELS=Object.freeze([...ANCHOR_TYPE_GROUPS.source].reverse());
const sourceRoot=title=>{
  const label=norm(title);
  return label==='mutlimedia'||label==='multimedia'?'media':
    label==='pastby'?'custom':'system';
};

/** Pure projection of published silver.loc_anchor rows for Culture/Statistics.
 * The DB query is handled by the existing public ZModel reader; this creates
 * no foreign keys, persistent aliases, extra tables, or article-side changes.
 */
export function sourceTaxonomyFromAnchors(rows=[]){
  const allowed=new Set(SOURCE_LEVELS);
  const nodes=(Array.isArray(rows)?rows:[]).filter(row=>
    allowed.has(row?.type)&&typeof row?.uid==='string'&&row.uid&&
    typeof row?.title==='string'&&row.title.trim()&&row.invisible!==true);
  const byUid=new Map(nodes.map(row=>[row.uid,row]));
  // Validate links and read typed children from the existing ZModel hierarchy.
  // Partial published lists may omit hidden descendants; unresolved IDs are not inferred.
  const graph=indexZModelAnchorHierarchy(nodes,{family:'source'});
  const roots=graph.roots.map(uid=>byUid.get(uid)).filter(Boolean);
  const categories=[],tree=[],visited=new Set();
  // Source alias labels are semantic identities, not UNIQUE columns. Build
  // the complete candidate set before publishing a lookup. Otherwise the
  // first Domain/From visited silently claims an ambiguous Galaxy.site.
  const aliasCandidates=new Map();
  const walk=(row,parents=[],root='system')=>{
    if(visited.has(row.uid))return;
    visited.add(row.uid);
    const level=SOURCE_LEVELS.indexOf(row.type);
    if(parents.length!==level)return;
    const path=[...parents,row];
    const universe=path[0]?.title||'',galaxy=path[1]?.title||'',
      domain=path[2]?.title||'';
    const entry={uid:row.uid,type:row.type,title:row.title,
      parentUid:parents.at(-1)?.uid||null,root,universe,galaxy,domain,
      path:path.map(item=>item.uid)};
    tree.push(entry);
    if(row.type==='from'||row.type==='domain'){
      categories.push({category_code:row.uid,display_name:row.title,
        enabled:true,type:row.type,root,universe,galaxy,
        domain:row.type==='from'?domain:row.title,
        parent_uid:entry.parentUid});
      for(const key of new Set([norm(row.title),sourceSiteKeyForLabel(row.title)])){
        if(!key)continue;
        if(!aliasCandidates.has(key))aliasCandidates.set(key,new Set());
        aliasCandidates.get(key).add(row.uid);
      }
    }
    for(const uid of graph.childrenOf(row.uid)){
      const child=byUid.get(uid);
      if(child&&SOURCE_LEVELS[level+1]===child.type)
        walk(child,path,root);
    }
  };
  for(const root of roots)walk(root,[],sourceRoot(root.title));
  const aliases=[],conflicts=[];
  for(const [key,candidates] of [...aliasCandidates].sort(([a],[b])=>a.localeCompare(b))){
    if(candidates.size===1){
      aliases.push({source_key:key,category_code:[...candidates][0]});
    }else conflicts.push({type:'source',alias:key,saved_uids:[...candidates].sort()});
  }
  return {categories,aliases,conflicts,groups:[],groupAliases:[],tree,
    roots:tree.filter(row=>row.type==='universe')};
}

// Read-only import audit: a Galaxy.site literal can be associated with a
// published SiteAnchor only when its alias has exactly one saved UID.
// A missing/ambiguous alias is never turned into a new Source node or a
// Galaxy.site rewrite; the original platform value remains authoritative.
export function auditImportedSourceSites(sites=[],taxonomy={}){
  if(!Array.isArray(sites)||!Array.isArray(taxonomy?.aliases)||
     !Array.isArray(taxonomy?.conflicts))
    throw new TypeError('Invalid SiteAnchor import audit');
  const available=new Map(taxonomy.aliases.map(row=>[norm(row.source_key),row.category_code]));
  const ambiguous=new Map(taxonomy.conflicts.map(row=>[norm(row.alias),row.saved_uids]));
  const resolved=[],unmatched=[],conflicts=[];
  const visited=new Set();
  for(const raw of sites){
    const site=String(raw??'').trim(),key=norm(site);
    if(!key||visited.has(key))continue;
    visited.add(key);
    if(ambiguous.has(key)){
      conflicts.push({type:'source',site,alias:key,saved_uids:[...ambiguous.get(key)]});
    }else if(available.has(key)){
      resolved.push({site,anchor_uid:available.get(key)});
    }else unmatched.push(site);
  }
  return {resolved,unmatched,conflicts};
}
