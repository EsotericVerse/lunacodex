// vis-timeline may finish construction while all of its rows are clipped,
// transparent or otherwise absent from the actual painted panel. Nonzero
// getBoundingClientRect() dimensions alone are not evidence of visibility.
// No DOM mutation or database fetch is performed by this read-only probe.
export function timelinePainted(root,getStyle=node=>getComputedStyle(node)){
  if(!root||typeof root.querySelector!=='function')return false;
  const left=root.querySelector('.vis-panel.vis-left');
  const center=root.querySelector('.vis-panel.vis-center');
  if(!left||!center||!root.querySelector('.vis-timeline'))return false;
  const box=root.getBoundingClientRect();
  if(box.width<16||box.height<16)return false;
  const painted=(node,panel)=>{
    if(!node||!panel)return false;
    for(let element=node;element;element=element.parentElement){
      const style=getStyle(element);
      if(!style||style.display==='none'||style.visibility==='hidden'||
        style.visibility==='collapse'||style.contentVisibility==='hidden'||
        Number(style.opacity)<0.01)return false;
      if(element===root)break;
    }
    const rect=node.getBoundingClientRect();
    const area=panel.getBoundingClientRect();
    // A vis range may have a healthy rectangle entirely outside the camera.
    // Count only the pixels actually intersecting the visible chart panel.
    const width=Math.min(rect.right,area.right,box.right)-
      Math.max(rect.left,area.left,box.left);
    const height=Math.min(rect.bottom,area.bottom,box.bottom)-
      Math.max(rect.top,area.top,box.top);
    return width>2&&height>2;
  };
  return Array.from(root.querySelectorAll('.vis-panel.vis-left .vis-label'))
    .some(node=>painted(node,left))&&
    Array.from(root.querySelectorAll('.vis-panel.vis-center .vis-item'))
      .some(node=>painted(node,center));
}
