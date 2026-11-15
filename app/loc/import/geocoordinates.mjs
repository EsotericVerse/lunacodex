// Extract location coordinates from supplied data only. No paid geocoding, network requests or place-name guessing.
const numeric=v=>v===null||v===undefined||String(v).trim()===''?NaN:Number(v);
export function importGeoPoint(latitude,longitude){
  const lat=numeric(latitude),lng=numeric(longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180
    ?{latitude:lat,longitude:lng}:null;
}
export function importGeoKey(value){
  const point=Array.isArray(value)?importGeoPoint(value[1],value[0]):
    importGeoPoint(value?.latitude,value?.longitude);
  return point?JSON.stringify([point.longitude,point.latitude]):'';
}
function pair(value){
  const m=String(value||'').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m?importGeoPoint(m[1],m[2]):null;
}
export function importMapUrlCoordinates(value){
  if(typeof value!=='string'||value.length>4096)return null;
  let url;
  try{url=new URL(value.trim());}catch{return null;}
  if(!['http:','https:'].includes(url.protocol)||
    !/(^|\.)google\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2,3})$/i.test(url.hostname))return null;
  if(!/(^|\/)maps(\/|$)/i.test(url.pathname)&&!url.hostname.startsWith('maps.'))return null;
  // !3d / !4d identifies the selected place; @lat,lng is a map viewport fallback.
  let raw;
  try{raw=decodeURIComponent(url.pathname+url.search+url.hash);}catch{return null;}
  const feature=raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if(feature)return importGeoPoint(feature[1],feature[2]);
  for(const key of ['q','query','ll','center','sll','destination','daddr']){
    const found=pair(url.searchParams.get(key));if(found)return found;
  }
  const viewport=raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
  return viewport?importGeoPoint(viewport[1],viewport[2]):null;
}
function objectPoint(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  if(value.type==='Point'&&Array.isArray(value.coordinates))
    return importGeoPoint(value.coordinates[1],value.coordinates[0]);
  const encoded=value.latitudeE7!==undefined||value.latE7!==undefined||
    value.longitudeE7!==undefined||value.lngE7!==undefined;
  const lat=value.latitude??value.lat??value.latitudeE7??value.latE7;
  const lng=value.longitude??value.lng??value.lon??value.long??value.longitudeE7??value.lngE7;
  if(lat!==undefined&&lng!==undefined){
    const point=importGeoPoint(encoded?numeric(lat)/1e7:lat,encoded?numeric(lng)/1e7:lng);
    if(point)return point;
  }
  if(typeof value.latLng==='string'){
    const result=pair(value.latLng.replace(/^geo:/i,''));if(result)return result;
  }
  if(typeof value.point==='string'){
    const result=pair(value.point.replace(/^geo:/i,''));if(result)return result;
  }
  if(Array.isArray(value.coordinates)&&value.coordinates.length===2)
    return importGeoPoint(value.coordinates[1],value.coordinates[0]);
  return null;
}
const PLACES=['place','placeLocation','place_location','location','checkin','check_in',
  'venue','geo','geometry','position','coordinate','coordinates','location_data','locationData','address'];
const URLS=['map_url','maps_url','google_maps_url','place_url','location_url','mapUrl','mapsUrl','url','href','link','permalink','value'];
const CONTAINERS=['data','attachments','array','media','photos','videos','label_values','dict','metadata'];
export function extractImportCoordinates(source){
  if(!source||typeof source!=='object')return null;
  const visited=new WeakSet();let count=0;
  function visit(value,depth){
    if(!value||typeof value!=='object'||depth>7||count++>2000||visited.has(value))return null;
    visited.add(value);
    if(Array.isArray(value)){
      for(const part of value.slice(0,250)){
        const result=visit(part,depth+1);if(result)return result;
      }
      return null;
    }
    for(const key of PLACES){
      const item=value[key];
      if(item&&typeof item==='object'){
        const result=objectPoint(item)||visit(item,depth+1);if(result)return result;
      }else if(typeof item==='string'){
        const result=importMapUrlCoordinates(item);if(result)return result;
      }
    }
    const direct=objectPoint(value);
    if(direct)return direct;
    for(const key of URLS){
      const result=importMapUrlCoordinates(value[key]);if(result)return result;
    }
    for(const key of CONTAINERS){
      const result=visit(value[key],depth+1);if(result)return result;
    }
    return null;
  }
  return visit(source,0);
}
