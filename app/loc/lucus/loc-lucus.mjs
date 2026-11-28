/**
 * LOCLucus is LOC's single logical relationship graph.
 *
 * Its four public facets are fixed. They are projections over LOC's existing
 * records, not four independent stores and not a new SQL schema:
 *   culture -> time relations (Era > Period > Date)
 *   trace   -> space relations (Trace > Path > Point)
 *   statics -> keyword relations (Category > Class > Group > Item > Pattern)
 *   search  -> Galaxy article/search relations
 *
 * Persistence and UID edges remain owned by LOC's existing data layer. This
 * module defines product-level ownership and the stable feature graph only.
 */
export const LOC_LUCUS_ID='LOCLucus';

export const LOC_LUCUS_FACETS=Object.freeze([
  Object.freeze({
    id:'culture',
    label:'Culture',
    relation:'time',
    hierarchy:Object.freeze(['era','period','date'])
  }),
  Object.freeze({
    id:'trace',
    label:'Trace',
    relation:'space',
    hierarchy:Object.freeze(['trace','path','point'])
  }),
  Object.freeze({
    id:'statics',
    label:'Statics',
    relation:'keyword',
    hierarchy:Object.freeze(['category','class','group','item','pattern'])
  }),
  Object.freeze({
    id:'search',
    label:'Search',
    relation:'galaxy',
    hierarchy:Object.freeze(['article','keyword'])
  })
]);

export const LOC_LUCUS_RELATIONS=Object.freeze([
  ...LOC_LUCUS_FACETS.map(facet=>Object.freeze({
    from:LOC_LUCUS_ID,to:facet.id,kind:'facet'
  })),
  ...LOC_LUCUS_FACETS.map(facet=>Object.freeze({
    from:facet.id,to:facet.relation,kind:'uses'
  }))
]);

export const LOC_LUCUS_GRAPH=Object.freeze({
  id:LOC_LUCUS_ID,
  facets:LOC_LUCUS_FACETS,
  relations:LOC_LUCUS_RELATIONS
});

const facetIndex=new Map(LOC_LUCUS_FACETS.map(facet=>[facet.id,facet]));

export function locLucusFacet(value){
  return facetIndex.get(String(value||'').trim().toLowerCase())||null;
}

export function isLocLucusFacet(value){
  return facetIndex.has(String(value||'').trim().toLowerCase());
}
