// Bounded, read-only image metadata inspection. No image or preview is persisted.
// JPEG APP1/TIFF and PNG eXIf are supported; missing EXIF is a normal result.
const maxBytes=256*1024;
const ascii=(v)=>String.fromCharCode(...v).replace(/\0.*$/,'');
function tiff(bytes){
  if(bytes.length<8)return null;
  const little=bytes[0]===73&&bytes[1]===73;
  if(!little&&!(bytes[0]===77&&bytes[1]===77))return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=o=>o>=0&&o+2<=bytes.length?view.getUint16(o,little):null;
  const u32=o=>o>=0&&o+4<=bytes.length?view.getUint32(o,little):null;
  if(u16(2)!==42)return null;
  function fields(offset){
    const n=u16(offset);if(n===null||n>256||offset+2+12*n+4>bytes.length)return new Map();
    const map=new Map();
    for(let i=0;i<n;i++){
      const p=offset+2+12*i;
      map.set(u16(p),{type:u16(p+2),count:u32(p+4),at:p+8,value:u32(p+8)});
    }
    return map;
  }
  function read(entry){
    if(!entry||!entry.count||entry.count>256)return null;
    const sizes={1:1,2:1,3:2,4:4,5:8,7:1,10:8};
    const size=sizes[entry.type];
    if(!size)return null;
    const length=size*entry.count;
    const off=length<=4?entry.at:entry.value;
    if(off<0||off+length>bytes.length)return null;
    return bytes.subarray(off,off+length);
  }
  function rational(entry){
    if(!entry||entry.type!==5||entry.count!==3)return null;
    const v=read(entry);if(!v)return null;
    const dv=new DataView(v.buffer,v.byteOffset,v.byteLength);
    const out=[];
    for(let i=0;i<3;i++){
      const n=dv.getUint32(8*i,little),d=dv.getUint32(8*i+4,little);
      if(!d)return null;
      out.push(n/d);
    }
    return out;
  }
  const base=fields(u32(4));
  const gps=fields(base.get(0x8825)?.value);
  function coord(refTag,valuesTag,max){
    const ref=read(gps.get(refTag)),dms=rational(gps.get(valuesTag));
    if(!ref||!dms)return null;
    const c=ascii(ref).toUpperCase();
    if(!'NSEW'.includes(c)||dms.some(n=>!Number.isFinite(n)||n<0)||dms[1]>=60||dms[2]>=60)return null;
    const result=dms[0]+dms[1]/60+dms[2]/3600;
    if(result>max)return null;
    return 'SW'.includes(c)?-result:result;
  }
  const latitude=coord(1,2,90),longitude=coord(3,4,180);
  const exif=fields(base.get(0x8769)?.value);
  const dt=read(exif.get(0x9003));
  const takenAt=dt?ascii(dt).trim():null; // Local camera time, timezone unknown.
  if(latitude===null&&longitude===null&&!takenAt)return null;
  return {...(latitude!==null&&longitude!==null?{latitude,longitude}:{}),
    ...(takenAt?{cameraLocalTime:takenAt}:{})};
}
export function readImageExif(prefix,path=''){
  if(!(prefix instanceof Uint8Array)||prefix.length<12||prefix.length>maxBytes)return null;
  const lower=String(path).toLowerCase();
  if(/\.jpe?g$/.test(lower)&&prefix[0]===255&&prefix[1]===216){
    let p=2;
    while(p+4<=prefix.length){
      if(prefix[p]!==255)break;
      const mark=prefix[p+1]; if(mark===218||mark===217)break;
      const len=(prefix[p+2]<<8)|prefix[p+3];
      if(len<2||p+2+len>prefix.length)break;
      if(mark===225&&ascii(prefix.subarray(p+4,p+10))==='Exif')
        return tiff(prefix.subarray(p+10,p+2+len));
      p+=2+len;
    }
  }
  if(/\.png$/.test(lower)&&prefix[0]===137&&prefix[1]===80&&prefix[2]===78&&prefix[3]===71){
    let p=8;
    while(p+12<=prefix.length){
      const len=((prefix[p]<<24)>>>0)+(prefix[p+1]<<16)+(prefix[p+2]<<8)+prefix[p+3];
      if(len>maxBytes||p+12+len>prefix.length)break;
      const type=ascii(prefix.subarray(p+4,p+8));
      if(type==='eXIf')return tiff(prefix.subarray(p+8,p+8+len));
      if(type==='IDAT')break;
      p+=12+len;
    }
  }
  return null;
}
export const IMAGE_EXIF_PREFIX_LIMIT=maxBytes;
