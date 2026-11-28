// Second-level Inter-Net projections built from the already present Lucus
// ZModel families. No new SQL schema, foreign key, fabricated parenthood or
// unbounded graph traversal. Caller owns authorization of every supplied row.
import {indexZModelLucusHierarchy} from './lucus-hierarchy.mjs';
import {auditImportedSourceSites} from '../../app/loc/source/classification.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const FAMILIES=new Set(['source','time','space']);

// Reuse the existing typed Lucus hierarchy for a single selected node.
// The target UIDs remain UNRESOLVED until individually read and authorized.
export function lucusInterNetChildren(row,family){
  if(!FAMILIES.has(family)||!UID.test(String(row?.uid||'')))
    throw new Error('Invalid Inter-Net Lucus or family');
  const hierarchy=indexZModelLucusHierarchy([row],{family,strict:false});
  return Object.freeze(hierarchy.links().map(edge=>Object.freeze({
    uid:edge.toUid,type:edge.toType,fromUid:edge.fromUid,
    field:edge.attrKey,resolved:false
  })));
}

// Public LOC SiteLucus tree already passed typed UID-hierarchy validation
// in sourceTaxonomyFromLucus. Only the unique published alias may match a
// Galaxy.site literal; similar labels do not prove identity.
export function sourceInterNetSelection(site,taxonomy={}){
  const audit=auditImportedSourceSites([site],taxonomy);
  if(audit.conflicts.length)return Object.freeze({status:'ambiguous',path:[],tree:[]});
  if(!audit.resolved.length)return Object.freeze({status:'unmatched',path:[],tree:[]});
  const uid=audit.resolved[0].lucus_uid;
  const rows=Array.isArray(taxonomy.tree)?taxonomy.tree:[];
  const indexed=new Map(rows.filter(row=>UID.test(String(row?.uid||'')))
    .map(row=>[row.uid,row]));
  const selected=indexed.get(uid);
  if(!selected||!Array.isArray(selected.path))return Object.freeze({
    status:'unmatched',path:[],tree:[]
  });
  const path=selected.path.map(key=>indexed.get(key)).filter(Boolean);
  if(path.length!==selected.path.length||path.at(-1)?.uid!==uid)
    return Object.freeze({status:'unmatched',path:[],tree:[]});
  // The complete published tree is already fetched only after opening this
  // branch. Keep it available for further branch expansion without another
  // query; parent-child edges came from verified Lucus.attr.uid, not titles.
  return Object.freeze({status:'resolved',uid,path,tree:rows});
}
