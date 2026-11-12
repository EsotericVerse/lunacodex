// Keep Karaul's PELT and penalty selection; accelerate only its documented
// Poisson CostFunction for safe integer count series. Integer prefix sums give
// the same segment cost as PoissonCost without rescanning each segment.
import {detectChangepoints,estimatePenalty,pelt,PoissonCost} from 'karaul';

export function detectCountChangepoints(series){
  const totals=new Float64Array(series.length+1);
  let sum=0;
  for(let index=0;index<series.length;index++){
    const next=sum+series[index];
    // The original cost remains authoritative outside exact integer counts.
    if(!Number.isSafeInteger(series[index])||series[index]<0||!Number.isSafeInteger(next))
      return detectChangepoints(series,new PoissonCost());
    totals[index+1]=sum=next;
  }
  return pelt(series,estimatePenalty(series),{
    compute(_series,start,end){
      const total=totals[end]-totals[start];
      return total===0?0:-2*total*Math.log(total/(end-start));
    }
  });
}
