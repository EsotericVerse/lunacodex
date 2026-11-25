// Reuse the generated OpenNext worker; only known /pics/ images get an R2 lookup.
import handler from '../.open-next/worker.js';
import {serveHeroAsset} from '../app/loc/blocks/hero-assets.mjs';
import {HERO_SOURCE_HASHES} from './hero-source-manifest.generated.mjs';
export * from '../.open-next/worker.js';

export default {
  ...handler,
  async fetch(request,env,ctx){
    const image=await serveHeroAsset(request,env,HERO_SOURCE_HASHES);
    return image??handler.fetch(request,env,ctx);
  }
};
