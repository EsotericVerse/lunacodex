// Composable Galaxy ZModel value types over ONE physical <scope>_galaxy row.
// The semantic shape is nested; the SQL transport remains a portable, flat,
// on-demand Kysely projection (no JOIN, table, migration or implicit read).
const optional=(type,array=false)=>Object.freeze({type,array,optional:true});
const required=type=>Object.freeze({type});

// Small bricks own their fields once. Composite bricks refer to them by type,
// rather than copying eight flags or UID relation/anchor fields into every view.
export const GALAXY_READ_MODEL_FIELDS=Object.freeze({
  // GalaxyAttr is eight flat physical flags: statics,culture,search,trace,list,keyword,extract,others.
// true = included for that feature; false = excluded; not the Anchor.invisible flag.
  GalaxyAttr:Object.freeze({
    statics:optional('Boolean'),culture:optional('Boolean'),search:optional('Boolean'),
    trace:optional('Boolean'),list:optional('Boolean'),keyword:optional('Boolean'),
    extract:optional('Boolean'),others:optional('Boolean')
  }),
  // GalaxyUidRelation is an on-demand projection of source_id/target_id/ref_id.
  GalaxyUidRelation:Object.freeze({
    source_id:optional('String'),target_id:optional('String',true),
    ref_id:optional('String')
  }),
  // GalaxyUidAnchor links pre-indexed media/place/date/site, not duplicate body text.
  GalaxyUidAnchor:Object.freeze({
    media_link:optional('String',true),place_id:optional('String'),
    location:optional('String'),date:optional('DateTime'),site:optional('String')
  }),
  // GalaxyList: uid/title/createtime/date/site plus the nested GalaxyAttr flags.
  GalaxyList:Object.freeze({
    uid:required('String'),title:optional('String'),
    createtime:optional('DateTime'),date:optional('DateTime'),
    site:optional('String'),attr:optional('GalaxyAttr')
  }),
  // GalaxyUidRead: uid/title/content/createtime/url plus UID relation/anchor projections.
  GalaxyUidRead:Object.freeze({
    uid:required('String'),title:optional('String'),
    content:optional('String'),createtime:optional('DateTime'),
    url:optional('String'),
    relation:optional('GalaxyUidRelation'),
    anchor:optional('GalaxyUidAnchor')
  })
});

// Flatten ONLY when constructing a physical SELECT. A nested reference cannot
// expand recursively forever or inject a non-column name into SQL.
function columnsOf(name,visited=new Set()){
  const fields=GALAXY_READ_MODEL_FIELDS[name];
  if(!fields)throw new Error('Unknown Galaxy read model: '+name);
  if(visited.has(name))throw new Error('Recursive Galaxy ZModel: '+name);
  const active=new Set(visited);active.add(name);
  const columns=[];
  for(const [field,spec] of Object.entries(fields)){
    if(Object.hasOwn(GALAXY_READ_MODEL_FIELDS,spec.type)){
      if(spec.array)throw new Error('Array of nested Galaxy ZModels is unsupported');
      columns.push(...columnsOf(spec.type,active));
    }else columns.push(field);
  }
  return [...new Set(columns)];
}

export const GALAXY_READ_MODEL_COLUMNS=Object.freeze(Object.fromEntries(
  Object.keys(GALAXY_READ_MODEL_FIELDS).map(name=>[
    name,Object.freeze(columnsOf(name))
  ])
));

// Existing callers keep receiving the same physical column list, including
// their original ordering, even though semantic fields now compose by type.
export const galaxyReadColumns=name=>{
  const columns=GALAXY_READ_MODEL_COLUMNS[name];
  if(!columns)throw new Error('Unknown Galaxy read model: '+name);
  return [...columns];
};
export const galaxyReadColumnsFor=(...names)=>[
  ...new Set(names.flat().flatMap(galaxyReadColumns))
];

// Explicit opt-in for consumers that need the real *nested* semantic object.
// No copying or fetching of additional rows: caller provides an already
// authorized flat Galaxy row from the existing query. Missing fields stay
// missing; values are not fabricated from null or from foreign Anchors.
export function composeGalaxyRead(name,row={}){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new TypeError('Galaxy read row must be an object');
  const visit=(type,seen)=>{
    const fields=GALAXY_READ_MODEL_FIELDS[type];
    if(!fields||seen.has(type))throw new Error('Invalid Galaxy ZModel composition');
    const next=new Set(seen);next.add(type);
    const value={};
    for(const [field,spec] of Object.entries(fields)){
      if(Object.hasOwn(GALAXY_READ_MODEL_FIELDS,spec.type)){
        const nested=visit(spec.type,next);
        if(Object.keys(nested).length)value[field]=nested;
      }else if(Object.hasOwn(row,field))value[field]=row[field];
    }
    return value;
  };
  return visit(name,new Set());
}
