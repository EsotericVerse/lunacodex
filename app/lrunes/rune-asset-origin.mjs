/** Only LRS owns Rune cards, group images and authored Effekseer media.
 * Web consumers link to the deployed LRS Worker; LOC IPA includes real files.
 * NEXT_PUBLIC_LOC_NATIVE_BUNDLE is set ONLY in LOC's existing native build.
 */
export const LRS_WEB_ORIGIN='https://lrs.lo3rwang.cc';
export const RUNE_ASSET_ORIGIN=process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'?'':LRS_WEB_ORIGIN;
export function runeAssetHref(path){
 if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//'))
   throw new Error('Rune media path must be root-relative');
 return RUNE_ASSET_ORIGIN+path;
}
