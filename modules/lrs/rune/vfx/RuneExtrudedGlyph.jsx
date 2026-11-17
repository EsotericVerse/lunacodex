'use client';

import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {RUNE_SOLID_DEPTH,RUNE_SOLID_FONTS,runeSolidShapes} from './rune-glyph-solid.mjs';

// Front-facing three-dimensional typography, not a separate magic FX engine.
// The established Eight Families / 66 rune colors stay the single authority.
const RAINBOW=Object.freeze([
  '#ff6374','#ffb34f','#fce87a','#64eeb4','#72c5ff','#aa91ff','#ef7ecc'
]);
function applySpectrumVertices(geometry){
  const position=geometry.getAttribute('position');
  const colors=new Float32Array(position.count*3);
  const bounds=new THREE.Box3().setFromBufferAttribute(position);
  const length=bounds.max.x-bounds.min.x||1;
  const palette=RAINBOW.map(color=>new THREE.Color(color));
  for(let i=0;i<position.count;i++){
    const t=Math.max(0,Math.min(.99999,(position.getX(i)-bounds.min.x)/length));
    const segment=t*(palette.length-1);
    const from=Math.floor(segment),blend=segment-from;
    const color=palette[from].clone().lerp(palette[from+1],blend);
    colors[3*i]=color.r;colors[3*i+1]=color.g;colors[3*i+2]=color.b;
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
}
function solidMaterials(profile,word){
  const spectrum=word==='彩';
  const stone=profile.finish==='stone';
  const glass=profile.finish==='glass';
  const ink=profile.ink;
  const face=new THREE.MeshPhysicalMaterial({
    color:spectrum?'#ffffff':ink,
    vertexColors:spectrum,
    metalness:glass?.23:stone?.03:.13,
    roughness:glass?.28:stone?.78:.51,
    clearcoat:glass?.7:stone?.07:.24,
    clearcoatRoughness:glass?.17:.42,
    side:THREE.DoubleSide
  });
  const edge=new THREE.MeshStandardMaterial({
    color:new THREE.Color(ink).multiplyScalar(stone?.54:.44),
    metalness:glass?.42:.14,roughness:glass?.34:.77,
    side:THREE.DoubleSide
  });
  return [face,edge];
}

export default function RuneExtrudedGlyph({word,profile}){
  const canvasRef=useRef(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let active=true,geometry,renderer,observer;
    let materials=[];
    let scene,camera;
    const canvas=canvasRef.current;
    if(!canvas||!word)return;
    setReady(false);
    const render=async()=>{
      const font=RUNE_SOLID_FONTS[profile.font]||RUNE_SOLID_FONTS.serif;
      // Google Fonts are already used for the ordinary glyph; wait for the
      // exact same family and weight before extracting contours.
      try{
        await document.fonts?.load(font.weight+' 302px "'+font.family+'"',word);
      }catch{
        // Browser may be offline; retain its visible 2D glyph fallback if the
        // actual outlines cannot be extracted.
      }
      if(!active||!canvas)return;
      const scratch=document.createElement('canvas');
      const shapes=runeSolidShapes(THREE,word,profile,scratch);
      if(!shapes.length)return;
      try{
        geometry=new THREE.ExtrudeGeometry(shapes,{
          depth:RUNE_SOLID_DEPTH,steps:1,curveSegments:2,
          bevelEnabled:true,bevelThickness:.045,bevelSize:.032,
          bevelSegments:3
        });
        geometry.computeVertexNormals();
        if(word==='彩')applySpectrumVertices(geometry);
        materials=solidMaterials(profile,word);
        renderer=new THREE.WebGLRenderer({
          canvas,alpha:true,premultipliedAlpha:false,
          antialias:true,powerPreference:'high-performance'
        });
        renderer.setClearColor(0x000000,0);
        renderer.outputColorSpace=THREE.SRGBColorSpace;
        renderer.toneMapping=THREE.NoToneMapping;
        scene=new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff,0x30233e,1.55));
        const key=new THREE.DirectionalLight(0xffffff,2.5);
        key.position.set(-3.5,5.5,8);scene.add(key);
        const rim=new THREE.DirectionalLight(0xc4cfff,1.25);
        rim.position.set(4,-2,4);scene.add(rim);
        const mesh=new THREE.Mesh(geometry,materials);
        mesh.position.z=-RUNE_SOLID_DEPTH*.5;
        mesh.rotation.set(0,0,0); // Face never rotates away from the reader.
        mesh.frustumCulled=false;
        scene.add(mesh);
        camera=new THREE.PerspectiveCamera(35,1,.1,100);
        camera.position.set(0,0,12);
        camera.lookAt(0,0,0);
        const resize=()=>{
          if(!active||!renderer||!camera)return;
          // CSS Motion scales the whole glyph up to its authored 3.05x
          // cinematic size. Use the untransformed layout box here, otherwise
          // measuring its animated bounding rect rasterizes a smaller bitmap.
          const width=canvas.offsetWidth,height=canvas.offsetHeight;
          if(width<8||height<8)return;
          renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio||1,2),3));
          renderer.setSize(width,height,false);
          camera.aspect=width/height;
          camera.updateProjectionMatrix();
          renderer.render(scene,camera);
        };
        resize();
        observer=new ResizeObserver(resize);
        observer.observe(canvas);
        if(active)setReady(true);
      }catch{
        // Never suppress a working authored glyph or its Effekseer animation
        // when local WebGL cannot create this optional solid-geometry layer.
      }
    };
    render();
    return ()=>{
      active=false;
      observer?.disconnect();
      geometry?.dispose();
      materials.forEach(material=>material.dispose());
      renderer?.dispose();
      // Match the Effekseer stage: releasing GPU resources does not release
      // the browser's WebGL context on repeatedly mounted glyph canvases.
      renderer?.forceContextLoss();
    };
  },[word,profile.font,profile.ink,profile.finish]);

  return <>
    <canvas ref={canvasRef} className="rune-3d-glyph-canvas"
      data-glyph-volume="extruded-geometry" aria-hidden="true"/>
    <span className="rune-3d-glyph-fallback"
      data-solid-ready={ready?'true':'false'} aria-hidden="true">{word}</span>
  </>;
}
