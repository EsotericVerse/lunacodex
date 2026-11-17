// Existing Rune view bridge: the actual draw and reading engine is lrs:card.
// LOC supplies loc:dialect explicitly; never construct SQL clients in lrs.
import {createCardModule,randomIndex,buildFixedReading} from '../../modules/lrs/card/draw-core.mjs';
let activeCardModule=null;
export function bindCardDialect(adapter){activeCardModule=createCardModule(adapter);return activeCardModule;}
export async function loadDrawCards(...args){
  if(!activeCardModule)throw new Error('lrs:card requires loc:dialect initialization before loading cards');
  return activeCardModule.loadDrawCards(...args);
}
export {randomIndex,buildFixedReading};
