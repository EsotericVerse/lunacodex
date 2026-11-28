/**
 * Lucus = Lucas + Locus = Lucus: the author's special Latin concept for a
 * light-based spacetime lucus, imagined as the sacred grove atop Universe
 * Tree. The particle-level Lucus architecture and Galaxy -> Universe ->
 * Universe Tree transformations are future design, not implemented here.
 *
 * This module defines only LOC's fixed domain projection, LOCLucus:
 *   Culture -> TLucus -> time (Era > Period > Date)
 *   Trace   -> LLucus -> space (Trace > Path > Point)
 *   Statics -> KLucus -> keyword (Category > Class > Group > Item > Pattern)
 *   Search  -> SLucus -> source/site (Universe > Galaxy > Domain > From)
 *
 * The four branches share the Lucus architecture. This registry is not the
 * particle engine, a fifth persistence layer, or the LunArcus protocol.
 */
export const LUCUS_ARCHITECTURE_ID='Lucus';
export const LUCUS_FORMULA='Lucas + Locus = Lucus';
export const LUCUS_MEANING='光之時空定錨點';
export const LUCUS_PLACEMENT='Universe Tree 上的神聖樹林';
export const LUCUS_DESIGN_STATUS='future';

export const LOC_LUCUS_ID='LOCLucus';

export const LOC_LUCUS_FACETS=Object.freeze([
  Object.freeze({
    id:'culture',
    label:'Culture',
    lucusId:'TLucus',
    domain:'time',
    hierarchy:Object.freeze(['era','period','date'])
  }),
  Object.freeze({
    id:'trace',
    label:'Trace',
    lucusId:'LLucus',
    domain:'space',
    hierarchy:Object.freeze(['trace','path','point'])
  }),
  Object.freeze({
    id:'statics',
    label:'Statics',
    lucusId:'KLucus',
    domain:'keyword',
    hierarchy:Object.freeze(['category','class','group','item','pattern'])
  }),
  Object.freeze({
    id:'search',
    label:'Search',
    lucusId:'SLucus',
    domain:'source',
    hierarchy:Object.freeze(['universe','galaxy','domain','from'])
  })
]);

export const LOC_LUCUS_RELATIONS=Object.freeze(
  LOC_LUCUS_FACETS.map(facet=>Object.freeze({
    from:LOC_LUCUS_ID,
    to:facet.lucusId,
    facet:facet.id,
    domain:facet.domain,
    kind:'lucus-domain'
  }))
);

export const LOC_LUCUS_GRAPH=Object.freeze({
  architecture:LUCUS_ARCHITECTURE_ID,
  id:LOC_LUCUS_ID,
  facets:LOC_LUCUS_FACETS,
  relations:LOC_LUCUS_RELATIONS
});

const facetIndex=new Map(LOC_LUCUS_FACETS.map(facet=>[facet.id,facet]));
const lucusIndex=new Map(LOC_LUCUS_FACETS.map(facet=>[facet.lucusId,facet]));

export function locLucusFacet(value){
  const key=String(value||'').trim();
  return facetIndex.get(key.toLowerCase())||lucusIndex.get(key)||null;
}

export function isLocLucusFacet(value){
  return Boolean(locLucusFacet(value));
}
