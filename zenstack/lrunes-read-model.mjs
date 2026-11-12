// ZModel-backed read projections for the existing silver.runes catalogue.
// LRunes66 is a semantic value type over the physical Runes model; these
// helpers keep every rune SELECT tied to that one ZModel field definition.
import {ANCHOR_PAYLOAD_DEFS} from './anchor-hierarchy.mjs';

const LRUNES66_MODEL='LRunes66';
const LRunes66_FIELDS=Object.freeze(Object.keys(ANCHOR_PAYLOAD_DEFS[LRUNES66_MODEL]||{}));
const LRunes66_FIELD_SET=new Set(LRunes66_FIELDS);

export const lRunes66Columns=(...fields)=>{
  const requested=fields.flat().filter(field=>field!==undefined&&field!==null);
  if(!requested.length)return [...LRunes66_FIELDS];
  const unknown=requested.filter(field=>!LRunes66_FIELD_SET.has(field));
  if(unknown.length)throw new Error('Unknown LRunes66 field: '+unknown.join(','));
  return [...new Set(requested)];
};

export const lRunes66ColumnString=(...fields)=>lRunes66Columns(...fields).join(',');

