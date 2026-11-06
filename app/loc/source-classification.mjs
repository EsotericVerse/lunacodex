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

// Construct one tree, not a parallel source-only classification engine.
// Keys are UI identities, not persisted UIDs or new Anchor types.
export function sourceTreeFromArrays(systemNames=[],personalNames=[],{
  universe='loc',galaxy='loc'
}={}){
  const system=classNames(systemNames);
  const known=new Set(system.map(key));
  const personal=classNames(personalNames).filter(name=>!known.has(key(name)));
  const root={type:'universe',keyword_type:'category',key:'universe:'+universe,
    name:universe,children:[]};
  const galaxyNode={type:'galaxy',keyword_type:'class',key:'galaxy:'+galaxy,
    name:galaxy,parent:root.key,children:[]};
  root.children.push(galaxyNode.key);
  const nodes=[root,galaxyNode];
  const append=(label,sourceNames)=>{
    if(!sourceNames.length)return;
    const domain={type:'domain',keyword_type:'group',
      key:'domain:'+galaxy+':'+label,name:label,parent:galaxyNode.key,children:[]};
    galaxyNode.children.push(domain.key);
    nodes.push(domain);
    sourceNames.forEach(name=>{
      const from={type:'from',keyword_type:'item',
        key:'from:'+galaxy+':'+key(name),name,parent:domain.key,
        children:[],site:name};
      domain.children.push(from.key);
      nodes.push(from);
    });
  };
  append('system',system);
  append('personal',personal);
  return nodes;
}

// The legacy Culture/Statistics selector format is a projection of the tree.
// No extra category JSONB, alias table or article-list rows are created.
export function sourceTaxonomyFromArrays(systemNames=[],personalNames=[]){
  const tree=sourceTreeFromArrays(systemNames,personalNames);
  const leaves=tree.filter(node=>node.type==='from');
  const system=leaves.filter(node=>node.parent.endsWith(':system'));
  const personal=leaves.filter(node=>node.parent.endsWith(':personal'));
  const categories=system.map(node=>({
    category_code:key(node.name),display_name:node.name,enabled:true
  }));
  const aliases=system.map(node=>({
    source_key:key(node.site),category_code:key(node.name)
  }));
  const groups=personal.map(node=>({
    group_code:key(node.name),display_name:node.name,enabled:true
  }));
  const groupAliases=personal.map(node=>({
    source_key:key(node.site),group_code:key(node.name)
  }));
  return {categories,aliases,groups,groupAliases};
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
