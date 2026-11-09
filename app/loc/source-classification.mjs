import {indexSourceTree} from './keyword-tree.mjs';
// Source names are labels on the same four-level classification model used by
// Keywords. Galaxy.site remains the immutable comparison key of an article.
// Tree levels are presentation/selection metadata, never new Galaxy columns.
//
// Universe = category (all), Galaxy = class (member/group),
// Domain = group (multiple sources), From = item (one Galaxy.site).
export const SOURCE_KEYWORD_LEVELS=Object.freeze({
  universe:'category',galaxy:'class',domain:'group',from:'item'
});
export const classNames=values=>[...new Set((Array.isArray(values)?values:[])
  .map(value=>String(value??'').trim()).filter(Boolean))];
const key=value=>String(value??'').trim().normalize('NFKC').toLocaleLowerCase();

// A single nonphysical projection of the existing Source ZModel:
// loc (Universe) -> loc (Galaxy) -> Default / Scope Domain -> From.
// The Default leaves come from silver.loc.DefaultArticleClass, while each
// Scope Domain / From comes from its *existing* saved Anchor UIDs. Virtual
// keys distinguish unpersisted parents; they are NOT fabricated Anchor UIDs.
export function sourceTreeFromCatalog(systemNames=[],entries=[],{
  universe='loc',galaxy='loc',scopeId='lo3rwang',domainUid='',domainTitle='',includeSystem=true
}={}){
  if(!Array.isArray(entries))throw new Error('Source catalogue must be an array');
  const root={type:'universe',keyword_type:'category',key:'universe:'+universe,
    name:universe,children:[]};
  const parent={type:'galaxy',keyword_type:'class',key:'galaxy:'+galaxy,
    name:galaxy,parent:root.key,children:[]};
  root.children.push(parent.key);
  const nodes=[root,parent],used=new Set();
  const append=(kind,name,leaves,uid='')=>{
    if(kind==='scope'&&scopeId==='loc')return;
    if(uid&&!/^[A-Za-z0-9]{8}$/.test(uid))
      throw new Error('Invalid persisted Domain UID');
    const physical=kind==='scope'&&/^[A-Za-z0-9]{8}$/.test(uid);
    const domain={
      type:'domain',keyword_type:'group',
      key:physical?'domain:'+scopeId+':'+uid:
        kind==='system'?'virtual-domain:system':
          'virtual-domain:scope:'+scopeId,
      ...(physical?{uid}:{}),name,parent:parent.key,
      source_scope:kind==='system'?'loc':scopeId,domain_kind:kind,children:[]
    };
    parent.children.push(domain.key);nodes.push(domain);
    for(const leaf of leaves){
      const site=String(leaf?.name??leaf?.site??'').trim();
      const label=String(leaf?.label??site).trim();
      if(!site||!label)throw new Error('Invalid From source');
      const identity=key(site);
      if(used.has(identity))throw new Error('Duplicate source across Domains: '+site);
      used.add(identity);
      const realUid=String(leaf?.uid||'');
      if(realUid&&!/^[A-Za-z0-9]{8}$/.test(realUid))
        throw new Error('Invalid persisted From UID');
      const from={
        type:'from',keyword_type:'item',
        key:realUid?'from:'+scopeId+':'+realUid:
          'from:'+(kind==='system'?'loc':scopeId)+':'+identity,
        ...(realUid?{uid:realUid}:{}),
        name:site,label,parent:domain.key,children:[],site,
        source_scope:kind==='system'?'loc':scopeId,domain_kind:kind
      };
      domain.children.push(from.key);nodes.push(from);
    }
  };
  if(includeSystem)append('system','Default',classNames(systemNames).map(name=>({name})));
  append('scope',String(domainTitle||scopeId),entries,domainUid);
  return nodes;
}
export function sourceTreeFromArrays(systemNames=[],personalNames=[],options={}){
  const system=classNames(systemNames),known=new Set(system.map(key));
  const entries=classNames(personalNames)
    .filter(name=>!known.has(key(name))).map(name=>({name}));
  return sourceTreeFromCatalog(system,entries,options);
}
// Read-only taxonomy for the existing chart and selection API. A From title
// remains the Galaxy.site comparison key. No count, article UID or secondary
// source registry is computed from the Source tree.
function sourceTaxonomyFromTree(tree){
  const leaves=tree.filter(row=>row.type==='from');
  const system=leaves.filter(row=>row.domain_kind==='system');
  const personal=leaves.filter(row=>row.domain_kind==='scope');
  return {
    categories:system.map(row=>({category_code:key(row.site),
      display_name:row.label,enabled:true})),
    aliases:system.map(row=>({source_key:key(row.site),
      category_code:key(row.site)})),
    groups:personal.map(row=>({group_code:key(row.site),
      display_name:row.label,enabled:true})),
    groupAliases:personal.map(row=>({source_key:key(row.site),
      group_code:key(row.site)}))
  };
}
export function sourceTaxonomyFromArrays(systemNames=[],personalNames=[]){
  return sourceTaxonomyFromTree(sourceTreeFromArrays(systemNames,personalNames));
}
// Keep short actual Galaxy.site codes distinct from presentation names.
// This is an ordinary string normalization, not a new source alias registry.
export function sourceSiteKeyForLabel(label){
  const display=key(label);
  if(display==='其他')return 'others';
  const suffix=display.match(/[a-z][a-z0-9_-]{2,}$/)?.[0]||'';
  return suffix||display;
}

// Match existing short site keys to a configured label without accidentally
// grouping unrelated sources (e.g. 'art' within 'smart'). An explicit label
// or its distinct suffix is accepted; historic '其他' maps to 'others'.
export function sourceLabelMatchesSite(site,label){
  const raw=key(site),display=key(label);
  if(!raw||!display)return false;
  if(raw===display)return true;
  if(raw==='others'&&display==='其他')return true;
  // Existing source display labels use a human name followed by its actual
  // ASCII site code, e.g. 方格子vocus and 無名wretch.
  return sourceSiteKeyForLabel(display)===raw;
}

// Canonical physical Anchor projection. Uses exactly the same UID edges as
// Keyword categories; Galaxy.site remains the string compared to the from title.
export function sourceTreeFromAnchors(rows=[]){
  const tree=indexSourceTree(rows);
  return [...tree.index.values()].map(node=>({
    type:node.type,keyword_type:SOURCE_KEYWORD_LEVELS[node.type],
    key:node.uid,uid:node.uid,name:node.name,
    parent:tree.parent.get(node.uid)||null,children:[...node.lists],
    ...(node.type==='from'?{site:node.name}:{})
  }));
}

// Public and statistics projections use the From Anchor's immutable source
// key (title) for matching and its independently editable label for display.
// Never infer Galaxy.site from the display label once an Anchor exists.
export function sourceTaxonomyFromCatalog(systemNames=[],entries=[],options={}){
  const tree=sourceTreeFromCatalog(systemNames,entries,options);
  return {...sourceTaxonomyFromTree(tree),tree};
}
