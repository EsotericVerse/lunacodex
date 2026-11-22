// Source river structure is the LOC-wide, UID-linked SiteAnchor tree.
// Universe -> Galaxy -> Domain -> From. Never flatten the tree by platform,
// merge a single child into its parent, or infer a parent from a site string.
// Only the article totals come from Scope-specific Galaxy.site counts.
export function buildCultureSourceTreeLanes(taxonomy={},groupedSources=[],expandedUids=[]){
  const nodes=Array.isArray(taxonomy?.tree)?taxonomy.tree:[];
  const byUid=new Map(nodes.map(row=>[row.uid,row]));
  const children=new Map(),totals=new Map();
  for(const row of nodes){
    if(!row.parentUid)continue;
    if(!children.has(row.parentUid))children.set(row.parentUid,[]);
    children.get(row.parentUid).push(row.uid);
  }
  const add=(uid,count,sites)=>{
    const current=totals.get(uid)||{count:0,sites:new Set()};
    current.count+=count;
    for(const site of sites)if(String(site).trim())current.sites.add(site);
    totals.set(uid,current);
  };
  const other={count:0,sites:new Set()};
  for(const group of groupedSources){
    const count=Math.max(0,Number(group?.item_count)||0);
    if(!count)continue;
    const code=String(group?.key||'').split(':').at(-1);
    const node=byUid.get(code);
    const sites=Array.isArray(group.sites)?group.sites:[];
    if(!node){
      other.count+=count;
      for(const site of sites)if(String(site).trim())other.sites.add(site);
      continue;
    }
    for(const uid of node.path||[])add(uid,count,sites);
  }
  const expanded=new Set(expandedUids);
  const visible=[];
  const append=uid=>{
    const row=byUid.get(uid),current=totals.get(uid);
    if(!row)return;
    // Structure is not a frequency filter: every persisted node is visible
    // when its parent is expanded, including branches with zero articles.
    const activeChildren=children.get(uid)||[];
    const depth=Math.max(0,(row.path?.length||1)-1);
    visible.push({
      uid:row.uid,type:row.type,label:row.title,level:depth,
      path:row.path||[],root:row.root,groupId:'dual:source:'+row.uid,
      sourceKey:row.root+':'+row.uid,item_count:current?.count||0,
      sites:[...(current?.sites||[])],collapsible:activeChildren.length>0,
      selectable:activeChildren.length===0&&Boolean(current?.count)&&
        ['domain','from'].includes(row.type),
      expanded:expanded.has(row.uid)
    });
    if(expanded.has(uid))for(const child of activeChildren)append(child);
  };
  // Root order is presentation only. The parent and child UIDs come only
  // from silver.loc_anchor.attr.uid; no synthetic Universe is created.
  const rootOrder=new Map([['Words',0],['Mutlimedia',1],['PastBy',2]]);
  const roots=nodes.filter(row=>row.type==='universe')
    .sort((a,b)=>(rootOrder.get(a.title)??100)-(rootOrder.get(b.title)??100));
  for(const root of roots)append(root.uid);
  // A site without a matching From/Domain alias is NOT PastBy. PastBy is a
  // real Universe containing SeeYou > Yesterday; keep unknown sites separate.
  if(other.count)visible.push({
    uid:null,type:'unassigned',label:'未分類來源',level:0,path:[],
    root:'unassigned',groupId:'dual:source:unassigned',
    sourceKey:'custom:others',item_count:other.count,
    sites:[...other.sites],collapsible:false,selectable:true,expanded:false
  });
  return {visible,byUid,totals,unassignedCount:other.count,
    total:roots.reduce((sum,row)=>sum+(totals.get(row.uid)?.count||0),other.count)};
}

// Map each real Galaxy.site daily bucket to its exact saved Source UID chain.
// A From contribution rolls up to Domain, Galaxy and Universe exactly once.
export function rollupCultureSourceDays(rows=[],groupedSources=[],taxonomy={}){
  const lookup=new Map();
  for(const group of groupedSources){
    const code=String(group?.key||'').split(':').at(-1);
    for(const site of group?.sites||[])lookup.set(site,code);
  }
  const byUid=new Map((taxonomy?.tree||[]).map(row=>[row.uid,row]));
  const days=new Map(),maximum=new Map();
  for(const row of rows){
    const day=String(row.start_date||row.day||'').slice(0,10);
    const count=Math.max(0,Number(row.item_count)||0);
    if(!day||!count)continue;
    const node=byUid.get(lookup.get(String(row.category||'')));
    const path=node?.path||['unassigned'];
    for(const uid of path){
      const key=uid+'\u0000'+day;
      const sum=(days.get(key)||0)+count;
      days.set(key,sum);
      maximum.set(uid,Math.max(maximum.get(uid)||0,sum));
    }
  }
  return {days,maximum};
}
