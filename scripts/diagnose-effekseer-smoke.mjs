// Read-only diagnostic: authored Effekseer fog resources must resolve at the
// deployment location. Never edits effects, emitters, textures, or authored art.
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {EFFECT_ASSET_BLOBS} from './rune-effekseer-asset-manifest.mjs';
const base=resolve('public/vendor/effekseer/Collections/MAGICALxSPIRAL');
const targets=['MxS_foot_smoke2.efkefc','Texture/smoke_01.png','Texture/star.png'];
for(const name of targets){
 const path=resolve(base,name);
 let file;
 try{file=await readFile(path);}catch(e){console.log('[FOG-DIAG] MISSING FILE '+path+' '+String(e));continue;}
 console.log('[FOG-DIAG] FILE '+name+' bytes='+file.length+' leading-hex='+file.subarray(0,32).toString('hex'));
 if(name.endsWith('.png')){
   if(file.subarray(0,8).toString('hex')==='89504e470d0a1a0a'){
     console.log('[FOG-DIAG] PNG width='+file.readUInt32BE(16)+' height='+file.readUInt32BE(20)+' depth='+file[24]+' colorType='+file[25]);
     const chunks=[];
     let pos=8;
     while(pos+12<=file.length){
       const length=file.readUInt32BE(pos);
       const type=file.toString('ascii',pos+4,pos+8);
       chunks.push({type,length,position:pos});
       pos+=12+length;
       if(type==='IEND')break;
     }
     const trans=chunks.find(x=>x.type==='tRNS');
     const pal=chunks.find(x=>x.type==='PLTE');
     const palBytes=pal?.length||0;
     const transparency=trans?Array.from(file.subarray(trans.position+8,trans.position+8+trans.length)):[];
     console.log('[FOG-DIAG] PNG DETAILS '+name+' chunks='+chunks.map(x=>x.type+':'+x.length).join(',')+
       ' paletteColors='+(palBytes/3)+' transValues='+JSON.stringify(transparency.slice(0,30))+
       ' paletteTransparent='+transparency.filter(x=>x<255).length);

   }
 }else{
   const latin=file.toString('latin1').match(/[A-Za-z0-9_./\\-]{4,}/g)||[];
   const little=file.toString('utf16le').match(/[A-Za-z0-9_./\\-]{4,}/g)||[];
   const paths=[...new Set([...latin,...little].filter(x=>/texture|smoke|png|jpg|efkmat|model|\\\\|\.\/|\.\./i.test(x)))];
   console.log('[FOG-DIAG] EFFECT-PATHS '+name+' '+JSON.stringify(paths.slice(0,30)));
   for(const rel of paths){
     if(!/\.(png|jpg|jpeg|efkmat|efkmodel)$/i.test(rel))continue;
     const mapped=resolve(dirname(path),rel.replaceAll(String.fromCharCode(92),'/'));
     try{const info=await stat(mapped);console.log('[FOG-DIAG] REF '+rel+' => '+mapped+' exists='+info.size);}
     catch(e){console.log('[FOG-DIAG] REF MISSING '+rel+' => '+mapped);}
   }
 }
}
const entries=EFFECT_ASSET_BLOBS.filter(x=>x.target.startsWith('MAGICALxSPIRAL/Texture/'));
console.log('[FOG-DIAG] Manifest MAGICALxSPIRAL textures='+entries.length+' smoke png listed='+entries.some(x=>x.target==='MAGICALxSPIRAL/Texture/smoke_01.png'));
