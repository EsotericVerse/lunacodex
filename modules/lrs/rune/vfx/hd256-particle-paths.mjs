/**
 * Opt-in 256px Effekseer sprite trial.
 *
 * Preserve the original licensed resources and .efkefc files. Only ordinary
 * PNG sprite/color textures are redirected; atlas flipbooks, normal maps,
 * sampling noise, lookup ramps and masks retain their authored resolution.
 * The 256 target is the longest edge, with the source aspect ratio intact.
 */
export const HD256_SPRITE_EDGE=256;

export function isHd256ParticleTexture(filename){
  const file=String(filename||'').split(/[\/\\]/).pop()||'';
  if(!/\.png$/i.test(file)||file.startsWith('_'))return false;
  // Resizing these can corrupt sprite-sheet frames, UV lookup semantics or
  // material inputs, so they are intentionally outside the sprite pilot.
  return !/(flipbook|normal|noise|mask|ramp|lookup|grid|check|white|distort|flowmap|heightmap|gradient)/i.test(file);
}

export function redirectHd256ParticleTexture(resourcePath){
  if(typeof resourcePath!=='string')return resourcePath;
  // Effekseer may pass either relative or resolved dependency paths, sometimes
  // with backslashes. Add only a sibling directory; do not rewrite .efkefc.
  return resourcePath.replace(/(^|[\/\\])(Textures?)([\/\\])([^\/\\?#]+\.png)(?=$|[?#])/i,
    (original,prefix,dir,slash,filename)=>isHd256ParticleTexture(filename)
      ?prefix+dir+slash+'_hd256'+slash+filename
      :original);
}
