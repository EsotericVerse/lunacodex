/**
 * Scoped native Effekseer texture-matte repair.
 *
 * Only the recorded Illusion, Phase and Jade (reflection overlay) effects use
 * these alternate transparent PNGs. All 66 authored .efkefc binaries remain
 * byte-for-byte untouched. Does not manufacture particles or custom shaders.
 */
export const SOFT_MATTE_NAMES=Object.freeze([
  'Line1.png','Line2.png','particle2.png','smoke_01.png','star.png'
]);

export function redirectSoftMatteTexture(resourcePath){
  if(typeof resourcePath!=='string')return resourcePath;
  return resourcePath.replace(/(^|[\/\\])(Texture)([\/\\])([^\/\\?#]+\.png)(?=$|[?#])/i,
    (original,prefix,folder,slash,filename)=>
      SOFT_MATTE_NAMES.includes(filename)
        ?prefix+folder+slash+'_softmatte'+slash+filename
        :original);
}
