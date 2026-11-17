/**
 * The Rune project owns its real asset origin; LOC Web only links to it.
 * Native consumers receive the real files via the separate LunArcus IPA process.
 *
 * On Rune Web, Vite replaces VITE_LRS_ASSET_ORIGIN at build time. In generic
 * Node/native module consumers, the default is the local root path instead.
 */
const native=typeof process!=='undefined'&&process.env?.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1';
const nextOrigin=typeof process!=='undefined'?process.env?.NEXT_PUBLIC_LRS_ASSET_ORIGIN:'';
const viteOrigin=import.meta.env?.VITE_LRS_ASSET_ORIGIN||import.meta.env?.VITE_LRUNE_ASSET_ORIGIN||'';
// LOC Web consumes only LRS code by a pinned Git SHA: no image binaries enter its build.
// LOC native imports the identical module but resolves actual bundled assets locally.
const base=String(native?'':nextOrigin||viteOrigin).trim().replace(/\/+$/,'');
if(base&&!/^https?:\/\/[^/]+(?:\/.*)?$/.test(base))
  throw new Error('VITE_LRS_ASSET_ORIGIN must be an absolute HTTP(S) origin');

export function runeAssetUrl(relative){
  const source=String(relative||'');
  const parts=source.split('/');
  if(!source||source.startsWith('/')||source.includes('\\')||
    parts.some(x=>!x||x==='.'||x==='..')||/[?#]/.test(source))
    throw new Error('Unsafe Rune asset path: '+source);
  return (base||'')+'/'+source;
}
export const RUNE_WEB_ASSET_ORIGIN=base;
