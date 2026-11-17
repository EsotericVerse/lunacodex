/** Inspect/redirect only the already-authored MAGICALxSPIRAL fog texture URLs.
 * No emitters, shaders or visual substitutions are created here.
 * Supports relative paths, absolute URLs, Windows-style paths and cache queries.
 */
export const AMBIENT_FOG_IMAGE='/vendor/effekseer/Collections/MAGICALxSPIRAL/Texture/_fog-cloud-2048.png';

export function redirectAmbientFogTexture(path,{quality='original',onReplacement}={}){
  if(typeof path!=='string')return path;
  return path.replace(/(^|[/\\])(smoke_01|star)\.png(?=$|[?#])/i,
    (whole,prefix,original)=>{
      const separator=prefix==='\\'?'\\':'/';
      const replacement=(quality==='hd256'?'_hd256'+separator:'')+'_fog-cloud-2048.png';
      onReplacement?.({original:original.toLowerCase(),replacement});
      return prefix+replacement;
    });
}
