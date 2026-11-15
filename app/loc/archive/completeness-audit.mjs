// Vendor-neutral, read-only ZIP inventory. Every ZIP entry gets a disposition.
// Important: auditing the archive never proves the exporter included everything.
const CONTENT_EXT=/\.(?:json|jsonl|js|csv|tsv|txt|md|html?|xml|log)$/i;
const ASSET_EXT=/\.(?:jpe?g|png|gif|webp|heic|avif|mp[34]|m4a|wav|flac|mov|avi|pdf|docx?|xlsx?|pptx?|epub|zip|gz|sqlite|db|bin|svg|webm|ogg|opus)$/i;
const PROJECT_PATH=/(?:^|\/)(?:projects?|project[-_]files|project[-_]knowledge|workspaces?)(?:\/|[-_.]|$)/i;
const PROJECT_KEYS=/["'](project_id|project_uuid|projectId|project_name|projectName|project_instructions|projectInstructions|projects|workspace_id|workspaceId|folder_id|folderId)["']\s*:/g;
const PROJECT_IDS=/"(project_id|project_uuid|projectId|workspace_id|workspaceId|folder_id|folderId)"\s*:\s*"([^"\\]{1,180})"/g;
const LIMIT=32;
const fmt=path=>CONTENT_EXT.test(path)?'content':ASSET_EXT.test(path)?'asset':'unrecognized';
export function createArchiveCompletenessAudit(){
  const files=[];
  const projectFields=new Set();
  const projectIds=new Map();
  let refsBeyondLimit=false;
  const projectFiles=new Set();
  const otherPotentialProjects=new Set();
  function addFile(path){
    const entry={path,classification:fmt(path),inspection:'not-inspected',truncated:false};
    files.push(entry);
    if(PROJECT_PATH.test(path))projectFiles.add(path);
    return entry;
  }
  function addSample(entry,head,{truncated=false}={}){
    if(!entry||entry.inspection!=='not-inspected')throw new Error('Archive audit sample already accounted for');
    entry.inspection='sampled';
    entry.truncated=Boolean(truncated);
    const sample=String(head||'');
    for(const hit of sample.matchAll(PROJECT_KEYS)){
      const key=hit[1].replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();
      projectFields.add(key);
      if(!PROJECT_PATH.test(entry.path))otherPotentialProjects.add(entry.path);
    }
    for(const hit of sample.matchAll(PROJECT_IDS)){
      // Retain a bounded set of source ID references. They are not assumed to
      // be definitions; association can only be verified during full import.
      const key=hit[1].replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();
      const identity=key+'\u0000'+hit[2];
      const found=projectIds.get(identity);
      if(found){
        found.mentions++;
        if(found.paths.length<16&&!found.paths.includes(entry.path))found.paths.push(entry.path);
      }else if(projectIds.size<LIMIT){
        projectIds.set(identity,{field:key,id:hit[2],path:entry.path,paths:[entry.path],mentions:1});
      }else refsBeyondLimit=true;
    }
  }
  function report(){
    const totals={allFiles:files.length,sampled:0,partialSamples:0,notInspected:0,
      assets:0,unknownFiles:0,contentFiles:0};
    const attention=[];
    for(const entry of files){
      if(entry.classification==='asset')totals.assets++;
      if(entry.classification==='content')totals.contentFiles++;
      if(entry.classification==='unrecognized')totals.unknownFiles++;
      if(entry.inspection==='sampled'){
        totals.sampled++;
        if(entry.truncated)totals.partialSamples++;
      }else totals.notInspected++;
      if(entry.inspection!=='sampled'&&attention.length<LIMIT)
        attention.push({path:entry.path,reason:entry.classification==='asset'?'attachment-not-read':
          entry.classification==='content'?'not-sampled':'unrecognized-format'});
    }
    return {
      files:totals,
      projects:{
        possibleProjectFiles:projectFiles.size,
        additionalFilesWithProjectFields:otherPotentialProjects.size,
        observedFields:[...projectFields].sort(),
        sampleReferences:[...projectIds.values()],
        referencesCapped:refsBeyondLimit,
        candidatePaths:[...projectFiles].slice(0,LIMIT)
      },
      needsReview:totals.notInspected>0||totals.partialSamples>0,
      sourceExportCompleteness:'unverifiable',
      importRestorationStatus:'not-tested',
      attention,
      caveat:'Archive content was inventoried, but not exhaustively parsed or compared with the source account. Binary assets, partial samples and missing platform exports are not validated.'
    };
  }
  return {addFile,addSample,report};
}
