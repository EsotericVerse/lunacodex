// Semantic read projections over the existing physical <scope>_galaxy row.
// These are ZModel value types, not SQL tables or views.  Kysely still owns
// the portable SELECT and simply uses the same column groups on PostgreSQL,
// MySQL and SQL Server.
const optional=(type,array=false)=>Object.freeze({type,array,optional:true});
const required=type=>Object.freeze({type});

export const GALAXY_READ_MODEL_FIELDS=Object.freeze({
  GalaxyAttr:Object.freeze({
    statics:optional('Boolean'),culture:optional('Boolean'),search:optional('Boolean'),
    trace:optional('Boolean'),list:optional('Boolean'),keyword:optional('Boolean'),
    extract:optional('Boolean'),others:optional('Boolean')
  }),
  GalaxyList:Object.freeze({
    uid:required('String'),title:optional('String'),createtime:optional('DateTime'),
    date:optional('DateTime'),site:optional('String'),
    statics:optional('Boolean'),culture:optional('Boolean'),search:optional('Boolean'),
    trace:optional('Boolean'),list:optional('Boolean'),keyword:optional('Boolean'),
    extract:optional('Boolean'),others:optional('Boolean')
  }),
  GalaxyUidRelation:Object.freeze({
    uid:required('String'),source_id:optional('String'),
    target_id:optional('String',true),ref_id:optional('String')
  }),
  GalaxyUidAnchor:Object.freeze({
    uid:required('String'),media_link:optional('String',true),place_id:optional('String'),
    location:optional('String'),date:optional('DateTime'),site:optional('String')
  }),
  GalaxyUidRead:Object.freeze({
    uid:required('String'),title:optional('String'),content:optional('String'),
    createtime:optional('DateTime'),url:optional('String'),
    source_id:optional('String'),target_id:optional('String',true),ref_id:optional('String'),
    media_link:optional('String',true),place_id:optional('String'),location:optional('String'),
    date:optional('DateTime'),site:optional('String')
  })
});

export const GALAXY_READ_MODEL_COLUMNS=Object.freeze(Object.fromEntries(
  Object.entries(GALAXY_READ_MODEL_FIELDS).map(([name,fields])=>[
    name,Object.freeze(Object.keys(fields))
  ])
));

export const galaxyReadColumns=name=>{
  const columns=GALAXY_READ_MODEL_COLUMNS[name];
  if(!columns)throw new Error('Unknown Galaxy read model: '+name);
  return [...columns];
};

export const galaxyReadColumnsFor=(...names)=>[...new Set(names.flat().flatMap(galaxyReadColumns))];
