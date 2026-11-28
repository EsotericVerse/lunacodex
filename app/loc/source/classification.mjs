import {LUCUS_TYPE_GROUPS,indexZModelLucusHierarchy} from '../../../packages/zenstack/lucus-hierarchy.mjs';

// Public SiteLucus projection. The ZModel graph owns parent/child semantics.
const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export function sourceSiteKeyForLabel(value){
 const s=norm(value);return s==='其他'||s==='others'?'others':s.match(/[a-z][a-z0-9_-]{2,}$/)?.[0]||s;
}
export function sourceLabelMatchesSite(site,label){
 const a=norm(site),b=norm(label);
 return Boolean(a&&b&&(a===b||sourceSiteKeyForLabel(b)===a));
}
// CURRENT Site Tree Model: typed From/Domain/Galaxy/Universe payloads compose
// under SiteLucus; lucus-hierarchy.mjs validates real attr.uid child edges.
// Source taxonomy aliases and flat UI choices are projections of the one
// canonical tree; never infer parenthood from titles or create another tree.
// The source taxonomy is the existing LocLucus ZModel, not a second
// media/platform registry. Lucus attr.uid is the only hierarchy link.
// SiteLucus: from = one platform; domain = platform collection; galaxy = group; universe = all.
// Example: Meta (domain) > Facebook/Threads/Instagram (from); CMS/Article/Stream (galaxy).
// Example taxonomy (labels only; no automatic DB rewrite):
// Words > CMS > Meta > Facebook/Threads/Instagram; CMS > X > X Twitter.
// Words > CMS > EsotericVerse > LOC/LRS.
// Words > Article > MCP > web/Github/ChatGPT/Claude/Gemini; Article > Post > Vocus.
// Mutlimedia > Stream > Music > Suno/Spotify; Stream > Video > Youtube.
// PastBy > SeeYou > Closed > kkcity/無名wretch/MSN; NowON > ptt/pixnet.
// Source labels are not durable keys: Vocus supersedes "方格子vocus" only
// when source records are explicitly edited; never rewrite Galaxy.site on import.
// SiteLucus from/domain/galaxy/universe is a real UID-linked hierarchy; flat UI is only presentation.
// Never derive parenthood from matching display titles.
const SOURCE_LEVELS=Object.freeze([...LUCUS_TYPE_GROUPS.source].reverse());
const sourceRoot=title=>{
  const label=norm(title);
  return label==='mutlimedia'||label==='multimedia'?'media':
    label==='pastby'?'custom':'system';
};

/** Pure projection of the published SiteLucus JS snapshot for Culture/Statistics.
 * Publication reads silver.loc_lucus explicitly; feature reads stay in JS.
 * This creates no foreign keys, aliases, extra tables, or article-side changes.
 */
export function sourceTaxonomyFromLucus(rows=[],{includeHidden=false}={}){
  const allowed=new Set(SOURCE_LEVELS);
  const nodes=(Array.isArray(rows)?rows:[]).filter(row=>
    allowed.has(row?.type)&&typeof row?.uid==='string'&&row.uid&&
    typeof row?.title==='string'&&row.title.trim()&&
    (includeHidden||row.invisible!==true));
  const byUid=new Map(nodes.map(row=>[row.uid,row]));
  // Validate links and read typed children from the existing ZModel hierarchy.
  // Partial published lists may omit hidden descendants; unresolved IDs are not inferred.
  const graph=indexZModelLucusHierarchy(nodes,{family:'source'});
  const roots=graph.roots.map(uid=>byUid.get(uid)).filter(Boolean);
  const categories=[],tree=[],visited=new Set();
  // Source alias labels are semantic identities, not UNIQUE columns. Build
  // the complete candidate set before publishing a lookup. Otherwise the
  // first Domain/From visited silently claims an ambiguous Galaxy.site.
  const aliasCandidates=new Map();
  const walk=(row,parents=[],root='system')=>{
    if(visited.has(row.uid))return;
    const level=SOURCE_LEVELS.indexOf(row.type);
    if(level<0||parents.length&&SOURCE_LEVELS.indexOf(parents.at(-1).type)!==level-1)return;
    visited.add(row.uid);
    const path=[...parents,row];
    // No fabricated Universe/Galaxy/Domain for an orphan. A missing ancestor
    // creates a presentation-only 未分類 section; saved UID edges are unchanged.
    const complete=path.length===level+1&&path[0]?.type==='universe';
    const universe=complete?path[0]?.title||'':'';
    const galaxy=complete&&level>=1?path[1]?.title||'':'';
    const domain=complete&&level>=2?path[2]?.title||'':'';
    const entry={uid:row.uid,type:row.type,title:row.title,
      parentUid:parents.at(-1)?.uid||null,root,universe,galaxy,domain,
      orphanType:complete?null:path[0].type,
      level,path:path.map(item=>item.uid)};
    tree.push(entry);
    if((row.type==='from'||row.type==='domain')&&complete){
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
  // Disconnected saved nodes must remain visible. Walk each missing-parent
  // branch once, from its real highest available node, in level order.
  // These rows are not assigned synthetic parent IDs or source aliases.
  for(let level=1;level<SOURCE_LEVELS.length;level++)
    for(const row of nodes)
      if(row.type===SOURCE_LEVELS[level]&&!visited.has(row.uid))
        walk(row,[],'unclassified');
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
// published SiteLucus only when its alias has exactly one saved UID.
// A missing/ambiguous alias is never turned into a new Source node or a
// Galaxy.site rewrite; the original platform value remains authoritative.
export function auditImportedSourceSites(sites=[],taxonomy={}){
  if(!Array.isArray(sites)||!Array.isArray(taxonomy?.aliases)||
     !Array.isArray(taxonomy?.conflicts))
    throw new TypeError('Invalid SiteLucus import audit');
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
      resolved.push({site,lucus_uid:available.get(key)});
    }else unmatched.push(site);
  }
  return {resolved,unmatched,conflicts};
}
