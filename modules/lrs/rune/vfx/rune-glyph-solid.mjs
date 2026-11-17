/**
 * Actual Chinese-glyph volume: trace the selected authored CSS font's ink and
 * extrude its outside/inside contours with Three.js ExtrudeGeometry.
 *
 * No invented rune strokes, false CSS "3D" shadows or decorative particles.
 * Runs once per letter; the result is static, front-facing and physically lit.
 * Keeping the browser's font rasterization also preserves the eight canonical
 * lettering families without introducing additional font downloads.
 */
export const RUNE_SOLID_RASTER=384;
export const RUNE_SOLID_DEPTH=.23;

export const RUNE_SOLID_FONTS=Object.freeze({
  script:{family:'LXGW WenKai TC',weight:400},
  serif:{family:'Noto Serif TC',weight:700},
  brush:{family:'Ma Shan Zheng',weight:400},
  kai:{family:'LXGW WenKai TC',weight:700},
  soft:{family:'LXGW WenKai TC',weight:300},
  sharp:{family:'ZCOOL XiaoWei',weight:400},
  minimal:{family:'Noto Sans TC',weight:400}
});

const vertex=(x,y,width)=>y*width+x;
const signedArea=poly=>{
  let area=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    area+=a[0]*b[1]-b[0]*a[1];
  }
  return area*.5;
};
const inside=(p,poly)=>{
  let hit=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&
      p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
};
function simplify(points){
  if(points.length<10)return points;
  // A grid outline already preserves typography; remove straight runs and
  // subpixel stair-steps instead of creating an unrelated smooth font.
  const out=[];
  const keep=(a,b,c)=>{
    const dx=c[0]-a[0],dy=c[1]-a[1];
    const len=Math.hypot(dx,dy)||1;
    return Math.abs(dx*(b[1]-a[1])-dy*(b[0]-a[0]))/len>.70;
  };
  for(let i=0;i<points.length;i++){
    const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
    if(keep(a,b,c))out.push(b);
  }
  return out.length>=3?out:points;
}
export function runeInkContours(mask,width,height){
  if(!mask||mask.length!==width*height||width<8||height<8)
    throw Error('Invalid Chinese glyph coverage mask');
  const active=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&mask[y*width+x]!==0;
  const outgoing=new Map();
  const add=(ax,ay,bx,by)=>{
    const key=vertex(ax,ay,width+1);
    const edges=outgoing.get(key)||[];
    edges.push([bx,by]);
    outgoing.set(key,edges);
  };
  let black=0;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      if(!active(x,y))continue;
      black++;
      if(!active(x,y-1))add(x,y,x+1,y);
      if(!active(x+1,y))add(x+1,y,x+1,y+1);
      if(!active(x,y+1))add(x+1,y+1,x,y+1);
      if(!active(x-1,y))add(x,y+1,x,y);
    }
  }
  if(black<80||black>width*height*.9)return [];
  const loops=[];
  // Shared corner pixels may make a touching diagonal ambiguous. Keep only
  // closed contours; never hand-draw missing strokes.
  const maxEdges=outgoing.size*2+1;
  while(outgoing.size){
    const startKey=outgoing.keys().next().value;
    const sx=startKey%(width+1),sy=Math.floor(startKey/(width+1));
    const points=[[sx,sy]];
    let x=sx,y=sy,closed=false;
    for(let steps=0;steps<maxEdges;steps++){
      const k=vertex(x,y,width+1);
      const edges=outgoing.get(k);
      if(!edges?.length)break;
      const next=edges.pop();
      if(!edges.length)outgoing.delete(k);
      [x,y]=next;
      if(x===sx&&y===sy){closed=true;break;}
      points.push([x,y]);
    }
    if(closed&&points.length>=6){
      const clean=simplify(points.map(([px,py])=>[px,-py]));
      if(clean.length>=3&&Math.abs(signedArea(clean))>=2)loops.push(clean);
    }
  }
  return loops;
}
export function runeSolidShapes(THREE,word,fontProfile,canvas){
  if(!THREE||!canvas||!word)return [];
  const font=RUNE_SOLID_FONTS[fontProfile.font]||RUNE_SOLID_FONTS.serif;
  const n=RUNE_SOLID_RASTER;
  canvas.width=n;canvas.height=n;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return [];
  ctx.clearRect(0,0,n,n);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#fff';
  ctx.font=font.weight+' 302px "'+font.family+'"';
  ctx.fillText(word,n/2,n/2+8,n*.89);
  const rgba=ctx.getImageData(0,0,n,n).data;
  const mask=new Uint8Array(n*n);
  let minX=n,minY=n,maxX=0,maxY=0,ink=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const i=y*n+x;
    if(rgba[4*i+3]<105)continue;
    mask[i]=1;ink++;
    minX=Math.min(minX,x);minY=Math.min(minY,y);
    maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  if(ink<80)return [];
  const contours=runeInkContours(mask,n,n);
  if(!contours.length)return [];
  const dimension=Math.max(maxX-minX+1,maxY-minY+1);
  const unit=5.25/dimension;
  const centerX=(minX+maxX+1)/2,centerY=(minY+maxY+1)/2;
  const reshape=poly=>poly.map(([x,y])=>[(x-centerX)*unit,(y+centerY)*unit]);
  const outside=contours.filter(poly=>signedArea(poly)<0)
    .sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)));
  const holes=contours.filter(poly=>signedArea(poly)>0);
  const shapes=outside.map(outline=>{
    const points=reshape(outline);
    const shape=new THREE.Shape();
    shape.moveTo(...points[0]);
    for(const p of points.slice(1))shape.lineTo(...p);
    shape.closePath();
    return {outline,shape,area:Math.abs(signedArea(outline))};
  });
  for(const hole of holes){
    const owners=shapes.filter(item=>inside(hole[0],item.outline))
      .sort((a,b)=>a.area-b.area);
    if(!owners.length)continue;
    const points=reshape(hole);
    const path=new THREE.Path();
    path.moveTo(...points[0]);
    for(const p of points.slice(1))path.lineTo(...p);
    path.closePath();
    owners[0].shape.holes.push(path);
  }
  return shapes.map(item=>item.shape);
}
