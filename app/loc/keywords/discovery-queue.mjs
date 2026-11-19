import {produce} from 'immer';
import * as z from 'zod';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';

// Single bounded FIFO between Galaxy's ZModel read projection and the Worker.
// Only page metadata goes through Immer: NEVER put article bodies in a draft.
// One very large article must be allowed to occupy a page by itself.
const MIN_PAGE_ROWS=1;
// Only a ceiling on one SQL page fetch; the Worker still consumes it in its
// own WORKER_BATCH_ROWS/BYTES slices below, so raising this does not change
// how much a single Worker batch has to process at once.
const MAX_PAGE_ROWS=20000;
// A modest first probe, then immediately grow for short articles; no
// additional SQL or content-length probe is needed.
// Main uses a smaller calibration read; keep the one-row floor for huge articles.
const INITIAL_PAGE_ROWS=256;
const TARGET_QUEUE_BYTES=2*1024*1024;
const WORKER_BATCH_ROWS=768;
const WORKER_BATCH_BYTES=256*1024;
const LOW_WATER_RATIO=0.2;
const batchEnvelope=z.strictObject({
  requested:z.number().int().min(MIN_PAGE_ROWS).max(MAX_PAGE_ROWS),
  received:z.number().int().min(0).max(MAX_PAGE_ROWS),
  estimatedBytes:z.number().int().nonnegative()
});
// Keep transport validation on the composed *physical* Galaxy projection.
// Date now lives in the nested GalaxyUidAnchor brick.
const GALAXY_READ_COLUMNS=new Set(galaxyReadColumns('GalaxyUidRead'));
for(const field of ['uid','content','createtime','date']){
  if(!GALAXY_READ_COLUMNS.has(field))
    throw new Error('Galaxy ZModel discovery projection missing '+field);
}
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const rowBytes=row=>String(row?.content??'').length*2+192;

export class KeywordDiscoveryQueue{
  constructor(){
    this.rows=null;
    this.cursor=0;
    this.size=0;
    this.meta={pageRows:INITIAL_PAGE_ROWS,averageRowBytes:0,acceptedPages:0};
  }
  get readLimit(){return this.meta.pageRows}
  get remaining(){return this.rows?this.rows.length-this.cursor:0}
  get nearEmpty(){
    return this.remaining>0&&
      this.remaining<=Math.max(1,Math.ceil(this.size*LOW_WATER_RATIO));
  }
  accept(rows,requested){
    if(this.rows!==null)throw new Error('Keyword queue still contains an active page');
    const bytes=rows.reduce((sum,row)=>sum+rowBytes(row),0);
    const result=batchEnvelope.safeParse({requested,received:rows.length,estimatedBytes:bytes});
    if(!result.success||rows.length>requested)
      throw new Error('Keyword discovery queue received invalid page bounds');
    this.rows=rows.length?rows:null;
    this.cursor=0;
    this.size=rows.length;
    if(!rows.length)return;
    // Maximize throughput per measured payload byte: one huge article may
    // require a 1-row page, while short articles can fill thousands of rows.
    // Grow by at most 2x; shrink immediately when article size spikes.
    const measured=bytes/rows.length;
    this.meta=produce(this.meta,draft=>{
      draft.averageRowBytes=draft.acceptedPages===0||measured>draft.averageRowBytes
        ?measured:draft.averageRowBytes*0.65+measured*0.35;
      draft.acceptedPages++;
      const wanted=Math.max(1,Math.floor(
        TARGET_QUEUE_BYTES/Math.max(192,draft.averageRowBytes)));
      draft.pageRows=clamp(wanted,MIN_PAGE_ROWS,
        Math.min(MAX_PAGE_ROWS,draft.pageRows*2));
    });
  }
  take(){
    if(!this.remaining)return [];
    const from=this.cursor;
    let end=from,bytes=0;
    while(end<this.rows.length&&end-from<WORKER_BATCH_ROWS){
      const size=rowBytes(this.rows[end]);
      if(end>from&&bytes+size>WORKER_BATCH_BYTES)break;
      bytes+=size;end++;
    }
    const batch=this.rows.slice(from,end);
    this.cursor=end;
    if(this.cursor===this.size){
      // Release the complete original page as soon as the last slice leaves.
      this.rows=null;this.cursor=0;this.size=0;
    }
    return batch;
  }
}

export const keywordDiscoveryQueueLimits=Object.freeze({
  initialRows:INITIAL_PAGE_ROWS,maxRows:MAX_PAGE_ROWS,
  targetBytes:TARGET_QUEUE_BYTES,workerBatchRows:WORKER_BATCH_ROWS
});
