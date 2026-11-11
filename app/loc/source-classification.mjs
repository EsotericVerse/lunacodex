// Fixed LOC ArticleTag categories. No Source Anchor hierarchy or editing.
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
const SOURCE_LEVELS=Object.freeze(['universe','galaxy','domain','from']);
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
  const roots=nodes.filter(row=>row.type==='universe');
  const categories=[],aliases=[],tree=[],visited=new Set();
  const uniqueAliases=new Set();
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
      for(const key of [norm(row.title),sourceSiteKeyForLabel(row.title)]){
        if(!key||uniqueAliases.has(key))continue;
        uniqueAliases.add(key);
        aliases.push({source_key:key,category_code:row.uid});
      }
    }
    for(const uid of Array.isArray(row.attr?.uid)?row.attr.uid:[]){
      const child=byUid.get(uid);
      if(child&&SOURCE_LEVELS[level+1]===child.type)
        walk(child,path,root);
    }
  };
  for(const root of roots)walk(root,[],sourceRoot(root.title));
  return {categories,aliases,groups:[],groupAliases:[],tree,
    roots:tree.filter(row=>row.type==='universe')};
}
