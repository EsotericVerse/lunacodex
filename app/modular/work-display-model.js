'use client';

import {CultureTimelineModel} from './modules/culture-timeline/culture-timeline-model';

export const WORK_FALLBACK_TITLE='未命名作品';
export const MEDIA_FALLBACK_TITLE='未命名媒體';

export function workDisplayText(value){
  return CultureTimelineModel.decodeCultureText(value??'');
}

function workDisplayTitle({
  title='',
  fallback=WORK_FALLBACK_TITLE
}={}){
  const explicit=CultureTimelineModel.decodeCultureText(title??'').trim();
  return explicit||fallback;
}



export function workDisplayHeading(row={},{
  media=null,
  fallback=''
}={}){
  const isMedia=media===null?Boolean(row?.uid&&row?.type&&('url' in row||'description' in row)):Boolean(media);
  const explicitTitle=
    row?.title||
    row?.display_title||
    row?.name||
    '';
  return workDisplayTitle({
    title:explicitTitle,
    fallback:fallback||(isMedia?MEDIA_FALLBACK_TITLE:WORK_FALLBACK_TITLE)
  });
}
