// Homepage-only page turn. The outgoing face is the live DOM, not a cloned
// document or canvas. All animations are finite and owned by the caller.
export function scrollHomeTop(){
  window.scrollTo({top:0,left:0,behavior:'instant'});
}

export function turnHomeBlocks(direction,finish,scopeId='loc'){
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scope=scopeId==='lo3rwang'?'lo3rwang':'loc';
  const selector='.loc-next-main[data-loc-scope="'+scope+'"][data-loc-view="home"] .loc-home > .scope-editable-block';
  const animations=[];
  let active=true;
  if(!reduced){
    const angle=direction==='edit'?58:-58;
    for(const node of document.querySelectorAll(selector)){
      const box=node.getBoundingClientRect();
      if(box.width<=0||box.height<=0||box.bottom<=0||box.top>=window.innerHeight||typeof node.animate!=='function')continue;
      animations.push(node.animate([
        {transform:'perspective(1200px) rotateY(0deg)',opacity:1},
        {transform:'perspective(1200px) rotateY('+angle+'deg)',opacity:.12}
      ],{duration:180,easing:'ease-in',fill:'forwards'}));
    }
  }
  if(animations.length)Promise.allSettled(animations.map(animation=>animation.finished))
    .then(()=>{if(active)finish()});
  else finish();
  return ()=>{active=false;for(const animation of animations)animation.cancel()};
}
