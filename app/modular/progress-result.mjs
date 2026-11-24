// Presentation-only snapshot. No polling, extra read, or inferred progress.
export function selectProgressResult(previous,{key,values=[],completed=0,total=0,elapsed=0,complete=false}){
  const current=previous?.key===key?previous:null;
  const valid=values.filter(metric=>metric?.label&&Number.isFinite(metric.value)&&metric.value>=0);
  if(!valid.length)return current;
  if(complete){
    if(current?.complete&&JSON.stringify(current.values)===JSON.stringify(valid))return current;
    return {key,values:valid,complete:true};
  }
  if(current)return current;
  if(elapsed<650||completed<=0||(total>0&&completed/total<.4))return null;
  return {key,values:valid,complete:false};
}
