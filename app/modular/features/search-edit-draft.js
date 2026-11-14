// Edit-session helpers for Search results. Loaded only when an author opens
// an article or media entry for editing (dynamic import in Search.jsx), so the
// plain search page never ships this code.
import {plainTextToBlocks} from '../../loc/blocknote-content.mjs';
import {canonicalMediaAnchorType} from '../../../zenstack/anchor-hierarchy.mjs';

function nullableText(value){
  const text=String(value??'').trim();
  return text||null;
}
function listText(value){
  return Array.isArray(value)?value.join('\n'):'';
}
function parseListText(value){
  return [...new Set(String(value||'').split(/[\n,]+/g).map(item=>item.trim()).filter(Boolean))];
}
function datetimeLocalValue(value){
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);
  return local.toISOString().slice(0,16);
}
function isoOrNull(value,t){
  const text=String(value||'').trim();
  if(!text)return null;
  const date=new Date(text);
  if(Number.isNaN(date.getTime()))throw new Error(t('uiExtra.searchUI.articleDateInvalid'));
  return date.toISOString();
}
function galaxyDraftFromRow(row={},fallbackTitle='',plainTextToBlocks){
  const attrs={
    uid:String(row.uid||'').trim(),
    createtime:datetimeLocalValue(row.createtime),
    location:String(row.location||''),
    place_id:String(row.place_id||'').trim(),
    ...Object.fromEntries(['statics','culture','search','trace','list','keyword','extract','others'].map(k=>[k,row[k]!==false])), 
    UpdateTime:String(row.UpdateTime||''),
    url:String(row.url||''),
    source_id:String(row.source_id||'').trim(),
    target_id:listText(row.target_id),
    ref_id:String(row.ref_id||'').trim(),
    site:String(row.site||''),
    media_link:listText(row.media_link),
  };
  const body=String(row.content??'');
  return {
    title:String(row.title??fallbackTitle??''),
    originalTitle:String(row.title??fallbackTitle??''),
    body,
    bodyHtml:body,
    bodyBlocks:plainTextToBlocks(body),
    editorKey:String(row.uid||''),
    hidden:row.list===false,
    attrs,
    originalAttrs:{...attrs}
  };
}

function mediaDraftFromRow(row={},fallbackTitle='',plainTextToBlocks){
  const attrs={
    uid:String(row.uid||''), title:String(row.title||''),
    type:String(row.type||''),
    url:String(row.url||''),description:String(row.description||''),
    createtime:datetimeLocalValue(row.createtime)
  };
  return {title:String(row.title??fallbackTitle??''),originalTitle:String(row.title??fallbackTitle??''),
    body:'',bodyHtml:'',bodyBlocks:plainTextToBlocks(''),editorKey:String(row.uid||''),
    attrs,originalAttrs:{...attrs},
    originalMediaAttr:row.attr&&typeof row.attr==='object'?{...row.attr}:{}};
}
function changedMediaAttributes(draft,t){
  const current=draft?.attrs||{},initial=draft?.originalAttrs||{},changed={};
  if(current.type!==initial.type)
    changed.type=canonicalMediaAnchorType(current.type,current.url);
  if(current.description!==initial.description)
    changed.description=nullableText(current.description);
  const dateChanged=current.createtime!==initial.createtime;
  if(dateChanged)changed.createtime=isoOrNull(current.createtime,t);
  if(current.url!==initial.url||dateChanged){
    const attr={...(draft.originalMediaAttr||{})};
    const url=nullableText(current.url);
    if(url)attr.url=url;else delete attr.url;
    if(dateChanged){
      if(changed.createtime)attr.date=changed.createtime.slice(0,10);
      else delete attr.date;
    }
    changed.attr=attr;
  }
  return changed;
}
function changedGalaxyAttributes(draft,t){
  const current=draft?.attrs||{},initial=draft?.originalAttrs||{};
  const changed={};
  const differs=key=>JSON.stringify(current[key])!==JSON.stringify(initial[key]);
  const features=['statics','culture','search','trace','list','keyword','extract','others'];
  for(const key of features)if(differs(key))changed[key]=current[key]!==false;
  if(differs('createtime'))changed.createtime=isoOrNull(current.createtime,t);
  if(differs('place_id')){
    const next=String(current.place_id||'').trim();
    if(next&&!/^[A-Za-z0-9]{8}$/.test(next))throw new Error('定錨點 ID 必須為八碼');
    changed.place_id=next||null;
  }
  for(const key of ['location','url','source_id','ref_id','site']){
    if(differs(key))changed[key]=nullableText(current[key]);
  }
  if(differs('target_id'))changed.target_id=parseListText(current.target_id);
  if(differs('media_link'))changed.media_link=parseListText(current.media_link);
  return changed;
}

export class SearchEditDraft{
  static nullableText(value){return nullableText(value);}
  // Builds the editable draft for a Galaxy article or MediaAnchor row.
  static fromRow(resourceType,row,fallbackTitle=''){
    return resourceType==='galaxy'
      ?galaxyDraftFromRow(row,fallbackTitle,plainTextToBlocks)
      :mediaDraftFromRow(row,fallbackTitle,plainTextToBlocks);
  }
  // Only the attributes the author actually changed; throws a localized error on invalid input.
  static changedAttributes(resourceType,draft,t){
    return resourceType==='galaxy'
      ?changedGalaxyAttributes(draft,t )
      :changedMediaAttributes(draft,t);
  }
}
