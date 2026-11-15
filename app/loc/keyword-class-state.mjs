// One Scope may analyze many Keyword Classes. The active Class chooses the
// default view only; completed results are independently keyed by Class UID.
// Physical Class Anchor UIDs are eight characters. Four-character IDs are
// accepted here ONLY for reading historical keyword_meta receipt keys; do not
// allocate four-character nodes, recreate an old Class table or restore its
// prior write path. Authorization and analysis require native Anchor UIDs.
const UID=/^[0-9A-Za-z]{4}(?:[0-9A-Za-z]{4})?$/;
export function keywordClassState(config={},classUid=''){
  if(!UID.test(classUid))return null;
  const meta=config.keyword_meta&&typeof config.keyword_meta==='object'
    ?config.keyword_meta:{};
  const record=meta.by_class?.[classUid];
  if(record&&typeof record==='object'){
    return record.completedAt&&!record.stale?record:null;
  }
  // Completion belongs exclusively to by_class[Class UID]; never fall back
  // to a shared scope-wide date, even for the configured default Class.
  return null;
}
export function invalidateKeywordClass(meta={},classUid=''){
  if(!UID.test(classUid))throw new Error('Invalid Keywords Class UID');
  const source=meta&&typeof meta==='object'?meta:{};
  const by_class={...(source.by_class||{})};
  delete by_class[classUid];
  return {...source,by_class};
}
export function completeKeywordClass(meta={},classUid='',result={},completedAt=''){
  if(!UID.test(classUid)||!completedAt)throw new Error('Invalid analysis completion');
  const source=meta&&typeof meta==='object'?meta:{};
  const by_class={...(source.by_class||{}),[classUid]:{
    ...result,class_uid:classUid,completedAt
  }};
  return {...source,by_class};
}
export function activeKeywordMeta(config={},classUid=''){
  const record=keywordClassState(config,classUid);
  return record?{...record,by_class:config.keyword_meta?.by_class||{}}:
    {by_class:config.keyword_meta?.by_class||{}};
}
