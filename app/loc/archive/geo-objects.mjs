// Read explicit Facebook place objects; never infer coordinates from post text or EXIF.
import {repairMojibakeText} from '../content/content-policy.js';
import {importGeoPoint,importGeoKey} from '../import/geocoordinates.mjs';

const CONTAINERS=['attachments','data','array','media','photos','videos','items','label_values','dict'];
const text=value=>repairMojibakeText(String(value??'').trim());
const placeUrl=value=>{
  if(typeof value!=='string')return null;
  try{
    const url=new URL(value.trim());
    return ['http:','https:'].includes(url.protocol)?url.href:null;
  }catch{return null;}
};

// A single Facebook record can contain separate attachments for media and
// place. Traverse the record, but deduplicate only identical numeric pairs.
// Names and URLs are optional source metadata, not coordinate match keys.
export function extractFacebookGeoObjects(raw){
  if(!raw||typeof raw!=='object')return [];
  const found=new Map(),visited=new WeakSet();let examined=0;
  function visit(node,depth){
    if(!node||typeof node!=='object'||depth>9||examined++>6000||visited.has(node))return;
    visited.add(node);
    if(Array.isArray(node)){
      for(const item of node.slice(0,1200))visit(item,depth+1);
      return;
    }
    const place=node.place&&typeof node.place==='object'?node.place:
      node.name&&node.coordinate&&typeof node.coordinate==='object'?node:null;
    if(place){
      const coordinate=place.coordinate||place.coordinates;
      const point=importGeoPoint(coordinate?.latitude,coordinate?.longitude);
      const key=importGeoKey(point);
      if(key&&!found.has(key)){
        const name=text(place.name||place.place_name||place.title).slice(0,200);
        const address=text(place.address||place.full_address).slice(0,500);
        found.set(key,{
          location:name||null,__importCoordinates:point,
          address:address||null,placeUrl:placeUrl(place.url)
        });
      }
    }
    for(const field of CONTAINERS)visit(node[field],depth+1);
  }
  visit(raw,0);
  return [...found.values()];
}

// A post may contain several distinct place objects. Never pick an arbitrary
// first coordinate for Galaxy.place_id when the source is ambiguous.
export function facebookPostPlace(raw){
  const places=extractFacebookGeoObjects(raw);
  return places.length===1?places[0]:null;
}
export function facebookPostCoordinate(raw){
  return facebookPostPlace(raw)?.__importCoordinates||null;
}
