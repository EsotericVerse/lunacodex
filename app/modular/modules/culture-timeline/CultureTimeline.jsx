'use client';
import FieldText from '../../../i18n/FieldText';
import {useUiLocale,useUiSection} from '../../../i18n/ui-locale';
import {translateUiField,registerDefaultSection} from '../../../i18n/ui-copy';
import cultureTimelineZh from '../../../i18n/sections/uiExtra.cultureTimeline.zh_tw.js';
registerDefaultSection('uiExtra.cultureTimeline',cultureTimelineZh);

import {useEffect,useMemo,useRef,useState} from 'react';
import {DataSet} from 'vis-data/esnext';
import {Timeline} from 'vis-timeline/esnext';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import {CultureTimelineModel} from './culture-timeline-model';
import useDefaultTimeUnit from '../../../loc/use-default-time-unit';

// Stable defaults matter: an inline [] or {} used as a hook dependency
// would destroy and recreate vis-timeline after setReady() on each render.
const EMPTY_ITEMS=Object.freeze([]);
const EMPTY_FOCUS=Object.freeze({});
const EMPTY_HIDDEN_DATES=Object.freeze([]);
const EMPTY_EXTRA_GROUPS=Object.freeze([]);
function defaultTimelineLabel(item,index){
  return item?.display_label||item?.name||item?.title||item?.period||'項目 '+(index+1);
}

function timelineRows(items,labelOf,focus,labels={}){
  const source=Array.isArray(items)?items:[];
  const focusTerms=[focus?.identity,focus?.period,focus?.anchor].filter(Boolean).map(String);
  // Avoid 5× temporary arrays and spread arguments for long source rivers.
  // A multi-year era can contain thousands of dense daily buckets.
  const today=Date.parse(new Date().toISOString().slice(0,10));
  let domainStart=Infinity,domainEnd=today;
  for(const item of source){
    for(const value of [item?.start_date,item?.active_from,item?.date,
      item?.end_date,item?.active_until]){
      const time=Date.parse(value||'');
      if(!Number.isFinite(time))continue;
      if(time<domainStart)domainStart=time;
      if(time>domainEnd)domainEnd=time;
    }
  }
  if(!Number.isFinite(domainStart))domainStart=today;
  return source.flatMap((item,index)=>{
    const rawStart=item?.start_date||item?.active_from||item?.date;
    const rawEnd=item?.end_date||item?.active_until;
    const openStart=Boolean(item?.open_start);
    const openEnd=Boolean(item?.open_end);
    const parsedStart=Date.parse(rawStart||'');
    const parsedEnd=Date.parse(rawEnd||'');
    const start=Number.isFinite(parsedStart)?rawStart:(openStart&&Number.isFinite(parsedEnd)?new Date(domainStart).toISOString().slice(0,10):null);
    if(!start||Number.isNaN(Date.parse(start)))return [];
    let end=Number.isFinite(parsedEnd)&&parsedEnd>Date.parse(start)?rawEnd:null;
    const densityRatio=Number(item?.global_density_ratio)>0?Number(item.global_density_ratio):Number(item?.density_ratio)||0;
    if(!end&&densityRatio>0){
      const next=new Date(Date.parse(start));
      next.setUTCDate(next.getUTCDate()+1);
      end=next.toISOString().slice(0,10);
    }
    if(!end&&openEnd&&domainEnd>Date.parse(start))end=new Date(domainEnd).toISOString().slice(0,10);
    const candidateValues=[
      item?.era_id,item?.period_id,item?.version,item?.id,item?.period,item?.name,item?.title,
      item?.anchor_id,item?.anchor_role,item?.anchor_type
    ].filter(Boolean).map(String);
    const focused=focusTerms.some(term=>candidateValues.includes(term));
    const group=item?.group_key||item?.group_label||item?.scope_id||'';
    const groupContent=item?.group_label||group;
    const groupOrder=Number.isFinite(Number(item?.group_order))?Number(item.group_order):null;
    const ratio=densityRatio;
    const density=ratio>0?CultureTimelineModel.densityStyleForRatio(ratio):CultureTimelineModel.densityStyleForCount(item?.item_count);
    const classes=[
      String(item?.className||item?.class_name||'').trim(),
      focused?'scope-period-timeline-focus':'',
      density?'scope-period-density':''
    ].filter(Boolean).join(' ');
    const densityStyle=density
      ?'--culture-density:'+Math.max(.08,Math.min(1,ratio||Math.min(1,Number(item?.item_count||0)/100)))+';height:'+(8+Math.round(Math.max(.08,Math.min(1,ratio||0))*20))+'px;background:color-mix(in srgb,var(--loc-accent) '+Math.round((.12+density.glow*.72)*100)+'%,var(--loc-panel));border-color:color-mix(in srgb,var(--loc-accent) '+Math.round((.36+density.glow*.56)*100)+'%,var(--loc-line));color:var(--loc-text);filter:brightness('+density.brightness+');box-shadow:0 0 '+density.blur+' color-mix(in srgb,var(--loc-accent) '+Math.round(density.glow*100)+'%,transparent);'
      :'';
    return [{
      id:String(item?.id||item?.entry_id||item?.era_id||item?.period_id||item?.version||index),
      content:labelOf(item,index),
      title:[
        item?.title,item?.description,item?.milestone,item?.anchor_role,item?.anchor_type,
        openStart?labels.openStart:'',openEnd?labels.openEnd:'',
        
        item?.is_primary_anchor?labels.primaryAnchor:'',item?.is_rc_zone?labels.rcZone:''
      ].filter(Boolean).join(' · '),
      start,
      recordId:String(item?.uid||item?.recordId||''),
      resourceId:String(item?.uid||''),
      scopeId:String(item?.scope_id||''),
      entryType:String(item?.entry_type||''),
      period:String(item?.period||''),
      runeCount:Number(item?.rune_count||0),
      workCount:Number(item?.item_count||0),
      openStart,openEnd,
      raw:item,
      ...(group?{group:String(group),groupContent:String(groupContent),groupOrder}:{}),
      ...(end?{end,type:'range'}:{type:'point'}),
      ...(classes?{className:classes}:{}),
      ...((densityStyle||item?.style)?{style:String(item?.style||'')+densityStyle}:{})
    }];
  });
}

function groupLabel(id){return String(id||'');}
function dateLabel(value){
  const formatted=CultureTimelineModel.formatCultureDateTime(value);
  return formatted.length>=10?formatted.slice(0,10):formatted;
}
function settle(handler,item,row,callback,defaultValue=null){
  if(!handler){callback(defaultValue);return;}
  Promise.resolve(handler(item,row)).then(result=>{
    if(result===true)callback(item);
    else callback(result||null);
  }).catch(()=>callback(null));
}


// Generate labels as vis-timeline group content; handlers always read the
// latest callbacks. This is shared by initial mount and in-place expansion.
function makeTimelineGroups(rows,extraGroups,hasTimeKinds,editable,labels,onGroupToggleRef,onGroupSelectRef){
      const timeGroupLabels={anchor:labels.anchor,event:labels.event,period:labels.period};
      const standardTimeKinds=Object.keys(timeGroupLabels);
      const membersByGroup=new Map();
      for(const row of rows){
        if(!row.group)continue;
        if(!membersByGroup.has(row.group))membersByGroup.set(row.group,[]);
        membersByGroup.get(row.group).push(row);
      }
      const foundGroups=[...membersByGroup.keys()];
      const additionalGroups=new Map(extraGroups.filter(group=>group?.id).map(group=>[String(group.id),group]));
      const ordinaryGroupIds=hasTimeKinds
        ?[...standardTimeKinds.filter(kind=>!editable||foundGroups.includes('kind:'+kind)).map(kind=>'kind:'+kind),...foundGroups.filter(id=>!String(id).startsWith('kind:'))]
        :foundGroups;
      const groupIds=[...new Set([...ordinaryGroupIds,...additionalGroups.keys()])];
      return groupIds.map((id,index)=>{
        const members=membersByGroup.get(id)||EMPTY_ITEMS;
        const explicit=members.map(row=>row.groupOrder).filter(Number.isFinite);
        const kind=String(id).startsWith('kind:')?String(id).slice(5):'';
        const defaultOrder=standardTimeKinds.indexOf(kind);
        const extra=additionalGroups.get(id);
        const label=extra?.label||members.find(row=>row.groupContent)?.groupContent||timeGroupLabels[kind]||groupLabel(id);
        let content=label;
        if(extra?.collapsible||extra?.selectable){
          const button=document.createElement('button');
          button.type='button';
          button.className='scope-river-group-button';
          button.textContent=extra.collapsible?(extra.expanded?'−  ':'＋  ')+label:label;
          button.setAttribute('aria-label',label);
          if(extra.collapsible){
            button.setAttribute('aria-expanded',String(Boolean(extra.expanded)));
            button.addEventListener('click',()=>onGroupToggleRef.current?.(id));
          }else button.addEventListener('click',()=>onGroupSelectRef.current?.(id));
          content=button;
        }
        return {
          id,
          content,
          order:Number.isFinite(extra?.order)?extra.order:explicit.length?Math.min(...explicit):defaultOrder>=0?defaultOrder:100+index,
          ...(extra?.className?{className:extra.className}:{}),
          title:label
        };
      });

}
export default function CultureTimeline({
  items=EMPTY_ITEMS,
  labelOf=defaultTimelineLabel,
  focus=EMPTY_FOCUS,
  mode='period',
  onSelect=null,
  onTimeClick=null,
  editable=false,
  onAdd=null,
  onMove=null,
  onUpdate=null,
  onRemove=null,
  windowStart='',
  windowEnd='',
  boundaryStart='',
  boundaryEnd='',
  onBoundaryNavigate=null,
  fixedMin='',
  fixedMax='',
  hiddenDates=EMPTY_HIDDEN_DATES,
  extraGroups=EMPTY_EXTRA_GROUPS,
  heightVariant='default',
  // The public Culture source river uses the library's natural content height
  // with a viewport cap; group count must never determine its container size.
  naturalSourceHeight=false,
  onGroupToggle=null,
  onGroupSelect=null,
  anchorInsight=null,
  anchorLabels=null,
  onAnchorClose=null
}){
  useUiSection('uiExtra.cultureTimeline');
  const {locale,copy}=useUiLocale();
  const defaultTimeUnit=useDefaultTimeUnit();
  const reduceMotion=useReducedMotion();
  const labels=copy.uiExtra.cultureTimeline;
  const timelineLocale=locale==='zh-Hans'?'zh-cn':locale==='zh-Hant'?'zh-tw':locale;
  const t=text=>translateUiField(locale,text);
  const containerRef=useRef(null);
  const timelineRef=useRef(null);
  const timelineDataRef=useRef(null);
  const timelineGroupsRef=useRef(null);
  const appliedHiddenDatesRef=useRef(hiddenDates);
  const doubleRiverWindowRef=useRef(null);
  const [selectedRowId,setSelectedRowId]=useState('');
  const onSelectRef=useRef(onSelect);
  const onGroupToggleRef=useRef(onGroupToggle);
  const onGroupSelectRef=useRef(onGroupSelect);
  const onTimeClickRef=useRef(onTimeClick);
  const onBoundaryNavigateRef=useRef(onBoundaryNavigate);
  const onAddRef=useRef(onAdd);
  const onMoveRef=useRef(onMove);
  const onUpdateRef=useRef(onUpdate);
  const onRemoveRef=useRef(onRemove);
  const [ready,setReady]=useState(false);
  const [chartError,setChartError]=useState(false);
  // A hidden/zero-count source group must not leave an item in vis-timeline:
  // otherwise the library may create an unlabeled row even after its group
  // was removed. Derive visible rows from the same group model as labels.
  const visibleItems=useMemo(()=>{
    if(heightVariant!=='double')return items;
    const visibleGroups=new Set(extraGroups.map(group=>String(group.id)));
    return items.filter(item=>{
      const kind=String(item?.entry_type||'');
      if(kind==='source_total'||kind==='source_group')
        return Number(item?.item_count)>0&&visibleGroups.has(String(item?.group_key||''));
      if(kind==='keyword_density')
        return Number(item?.item_count)>0&&Boolean(String(item?.group_label||'').trim());
      return true;
    });
  },[items,extraGroups,heightVariant]);
  const rows=useMemo(()=>timelineRows(visibleItems,labelOf===defaultTimelineLabel?(item,index)=>item?.display_label||item?.name||item?.title||item?.period||labels.item+' '+(index+1):labelOf,focus,labels),[visibleItems,labelOf,focus,labels]);
  // The chart-error fallback list is not used during a healthy render.
  // Avoid cloning and sorting thousands of buckets on every period switch.
  const fallbackRows=useMemo(()=>chartError
    ?[...rows].sort((a,b)=>String(b.start).localeCompare(String(a.start)))
    :EMPTY_ITEMS,[rows,chartError]);
  const selectedRow=useMemo(()=>rows.find(row=>row.id===selectedRowId)||null,[rows,selectedRowId]);
  // Keep all camera geometry inside vis-timeline, not Motion; animation applies
  // only to explicit navigation, never to dragging, date edits, or first paint.
  const cameraAnimation=reduceMotion?false:{duration:240,easingFunction:'easeInOutQuad'};
  const hasTimeKinds=mode==='overview'&&rows.some(row=>String(row.group||'').startsWith('kind:'));
  // Trace expand/collapse updates datasets in place to preserve pan, zoom
  // and touch position exactly like the lower numeric river.
  const preserveTimelineInstance=heightVariant==='double'||mode==='trace';
  const groupCount=Math.max(new Set([...rows.map(row=>row.group),...extraGroups.map(group=>group.id)].filter(Boolean)).size,hasTimeKinds&&!editable?4:0);
  const compactGroupCount=Math.max(1,groupCount||rows.length);
  // The double river must shrink after zero-count groups disappear.
  // A fixed 320px floor previously left a dark, empty band on 1–2 lanes.
  // Public Culture must grow in normal document flow: collapsed groups use
  // their natural height, and opening children adds real rows. The date axis
  // follows the last row. No group-count sizing or internal scroll cap.
  // Other Timeline consumers retain their established sizing behavior.
  const timelineMinHeight=naturalSourceHeight?null:heightVariant==='double'
    ?Math.max(186,110+compactGroupCount*58)
    :Math.max(180,96+compactGroupCount*46);
  const timelineMaxHeight=naturalSourceHeight?null:heightVariant==='double'
    ?Math.max(timelineMinHeight+28,148+compactGroupCount*72)
    :Math.max(360,Math.min(760,180+compactGroupCount*92));
  const timelineHeightOptions=naturalSourceHeight
    ?{}
    :{minHeight:timelineMinHeight+'px',maxHeight:timelineMaxHeight+'px'};

  useEffect(()=>{onSelectRef.current=onSelect},[onSelect]);
  useEffect(()=>{onGroupToggleRef.current=onGroupToggle},[onGroupToggle]);
  useEffect(()=>{onGroupSelectRef.current=onGroupSelect},[onGroupSelect]);
  useEffect(()=>{onTimeClickRef.current=onTimeClick},[onTimeClick]);
  useEffect(()=>{onBoundaryNavigateRef.current=onBoundaryNavigate},[onBoundaryNavigate]);
  useEffect(()=>{onAddRef.current=onAdd},[onAdd]);
  useEffect(()=>{onMoveRef.current=onMove},[onMove]);
  useEffect(()=>{onUpdateRef.current=onUpdate},[onUpdate]);
  useEffect(()=>{onRemoveRef.current=onRemove},[onRemove]);

  useEffect(()=>{
    let cancelled=false;
    let instance=null;
    let initialPanWindow=null;
    let boundaryChangeSent=false;
    timelineRef.current=null;
    setChartError(false);
    if(!containerRef.current||(!rows.length&&!editable&&!extraGroups.length)){setReady(false);return()=>{cancelled=true};}
    setReady(false);
    try{
      if(cancelled||!containerRef.current)return()=>{cancelled=true};
      const dataRows=rows.map(row=>editable?{
        ...row,
        editable:{
          updateTime:row.entryType==='anchor',
          updateGroup:false,
          remove:Boolean(row.recordId)
        }
      }:row);
      const data=new DataSet(dataRows);
      appliedHiddenDatesRef.current=hiddenDates;
      const groupRows=makeTimelineGroups(rows,extraGroups,hasTimeKinds,editable,labels,onGroupToggleRef,onGroupSelectRef);
      const groups=groupRows.length?new DataSet(groupRows):null;
      timelineDataRef.current=data;
      timelineGroupsRef.current=groups;
      const rowById=id=>data.get(String(id))||null;
      // Supply the selected camera range at construction time. Otherwise the
      // timeline may auto-fit all periods during its first layout after an
      // immediate setWindow(), making a chosen period appear to snap back.
      const hasSelectedWindow=Boolean(windowStart&&windowEnd&&
        Number.isFinite(Date.parse(windowStart))&&
        Number.isFinite(Date.parse(windowEnd))&&
        Date.parse(windowEnd)>=Date.parse(windowStart));
      const windowKey=[windowStart,windowEnd,fixedMin,fixedMax].join('|');
      // Keyword drill-down re-creates the visible groups, but it must not
      // reset the shared camera or disorient the source river above it.
      const priorWindow=heightVariant==='double'&&doubleRiverWindowRef.current?.key===windowKey
        ?doubleRiverWindowRef.current.range:null;
      instance=new Timeline(containerRef.current,data,groups,{
        ...(defaultTimeUnit==='auto'?{}:{timeAxis:{scale:defaultTimeUnit,step:1}}),
        ...(hasSelectedWindow?{start:priorWindow?.start||windowStart,end:priorWindow?.end||windowEnd}:{}),
        autoResize:true,
        ...timelineHeightOptions,
        // Explicitly retain a labeled date axis at the bottom of the
        // public density chart; its lane height must leave room for it.
        ...(naturalSourceHeight?{orientation:{axis:'bottom'},showMinorLabels:true,showMajorLabels:true}:{}),
        verticalScroll:!naturalSourceHeight,
        groupOrder:'order',
        locale:timelineLocale,
        locales:{
          [timelineLocale]:{
            current:labels.current,
            time:labels.time,
            deleteSelected:labels.deleteSelected
          }
        },
        format:{
          minorLabels:{
            millisecond:'SSS',second:locale==='en'?'s':'s'+labels.secondUnit,minute:'HH:mm',hour:'HH:mm',weekday:'M/D',day:'M/D',week:'M/D',month:'M/D'+labels.monthUnit,year:'YYYY'
          },
          majorLabels:{
            millisecond:'YYYY/M/D HH:mm:ss',second:'YYYY/M/D HH:mm',minute:'YYYY/M/D',hour:'YYYY/M/D',weekday:'YYYY/M',day:'YYYY/M',week:'YYYY/M',month:'YYYY'+labels.yearUnit,year:''
          }
        },
        // Wheel/pinch zoom and dragging must not require Ctrl, Alt, or other keys.
        horizontalScroll:false,
        zoomable:true,
        zoomKey:'',
        zoomMin:1000*60*60*24*14,
        zoomMax:1000*60*60*24*365*50,
        ...(Array.isArray(hiddenDates)&&hiddenDates.length?{hiddenDates}:{}),
        ...(fixedMin&&Number.isFinite(Date.parse(fixedMin))?{min:fixedMin}:{}),
        ...(fixedMax&&Number.isFinite(Date.parse(fixedMax))?{max:fixedMax}:{}),
        selectable:true,
        moveable:true,
        editable:editable?{add:Boolean(onAddRef.current),updateTime:true,updateGroup:false,remove:true,overrideItems:false}:false,
        ...(editable?{
          ...(onAddRef.current?{onAdd:(item,callback)=>settle(onAddRef.current,item,null,callback,null)}:{}),
          onMove:(item,callback)=>settle(onMoveRef.current,item,rowById(item.id),callback,null),
          onUpdate:(item,callback)=>settle(onUpdateRef.current,item,rowById(item.id),callback,null),
          onRemove:(item,callback)=>settle(onRemoveRef.current,item,rowById(item.id),callback,null)
        }:{}),
        showCurrentTime:false,
        stack:mode!=='source',
        margin:mode==='source'
          ?{axis:10,item:{horizontal:3,vertical:5}}
          :{item:{horizontal:8,vertical:12}}
      });
      timelineRef.current=instance;
      instance.on('select',({items:selectedItems=[]})=>{
        const row=rowById(selectedItems[0]);
        setSelectedRowId(row?.id||'');
        onSelectRef.current?.(row);
      });
      instance.on('rangechanged',properties=>{
        // Only a real user pan can advance the selected period. A click or a
        // ctrl+wheel zoom must not change periods.
        if(!onBoundaryNavigateRef.current||fixedMin||fixedMax||properties?.byUser!==true||!initialPanWindow||boundaryChangeSent)return;
        const startMs=Date.parse(boundaryStart||windowStart||'');
        const endMs=Date.parse(boundaryEnd||windowEnd||'');
        const visibleStart=properties?.start instanceof Date?properties.start.getTime():Date.parse(properties?.start||'');
        const visibleEnd=properties?.end instanceof Date?properties.end.getTime():Date.parse(properties?.end||'');
        const initialStart=initialPanWindow.start.getTime();
        const initialEnd=initialPanWindow.end.getTime();
        const initialSpan=initialEnd-initialStart;
        const visibleSpan=visibleEnd-visibleStart;
        if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||!Number.isFinite(visibleStart)||!Number.isFinite(visibleEnd)||initialSpan<=0||endMs<=startMs)return;
        if(Math.abs(visibleSpan-initialSpan)>Math.max(86400000,initialSpan*0.03))return;
        const shift=(visibleStart+visibleEnd-initialStart-initialEnd)/2;
        const threshold=Math.max(86400000,initialSpan*0.04);
        if(shift< -threshold&&visibleStart<startMs-threshold){
          boundaryChangeSent=true;
          onBoundaryNavigateRef.current('previous');
        }else if(shift>threshold&&visibleEnd>endMs+threshold){
          boundaryChangeSent=true;
          onBoundaryNavigateRef.current('next');
        }
      });
      // vis-timeline handles mouse double-click and touch double-tap here.
      // A single tap only selects; only an authorized caller may create an anchor.
      instance.on('doubleClick',properties=>{
        if(!onTimeClickRef.current)return;
        if(properties?.what!=='background'&&properties?.what!=='axis')return;
        const time=properties.time instanceof Date?properties.time:new Date(properties.time||'');
        if(Number.isNaN(time.getTime()))return;
        const year=time.getFullYear();
        const month=String(time.getMonth()+1).padStart(2,'0');
        const day=String(time.getDate()).padStart(2,'0');
        onTimeClickRef.current(year+'-'+month+'-'+day);
      });
      if(hasSelectedWindow){
        instance.setWindow(priorWindow?.start||windowStart,priorWindow?.end||windowEnd,{animation:false});
      }else{
        instance.fit({animation:false});
      }
      initialPanWindow=instance.getWindow();
      setReady(true);
    }catch(error){
      console.error('Culture timeline initial rendering failed',error);
      if(!cancelled){setReady(false);setChartError(true);}
    }
    return()=>{
      cancelled=true;
      if(instance&&heightVariant==='double'){
        try{
          doubleRiverWindowRef.current={
            key:[windowStart,windowEnd,fixedMin,fixedMax].join('|'),
            range:instance.getWindow()
          };
        }catch{doubleRiverWindowRef.current=null;}
      }
      if(timelineRef.current===instance){
        timelineRef.current=null;
        timelineDataRef.current=null;
        timelineGroupsRef.current=null;
      }
      if(instance)instance.destroy();
    };
  },[preserveTimelineInstance?null:rows,preserveTimelineInstance?null:extraGroups,
    hasTimeKinds,preserveTimelineInstance?null:timelineMinHeight,
    preserveTimelineInstance?null:timelineMaxHeight,
    Boolean(rows.length||editable||extraGroups.length),
    heightVariant,mode,naturalSourceHeight,windowStart,windowEnd,boundaryStart,boundaryEnd,fixedMin,fixedMax,
    preserveTimelineInstance?null:hiddenDates,editable,locale,labels,timelineLocale,defaultTimeUnit]);

  // When a group opens, mutate existing datasets instead of destroying and
  // recreating vis-timeline. Preserve camera zoom, pan and touch scroll.
  useEffect(()=>{
    if(!preserveTimelineInstance||!ready)return;
    const timeline=timelineRef.current,data=timelineDataRef.current;
    if(!timeline||!data)return;
    const nextRows=rows.map(row=>editable?{
      ...row,editable:{updateTime:row.entryType==='anchor',updateGroup:false,remove:Boolean(row.recordId)}
    }:row);
    const nextGroups=makeTimelineGroups(rows,extraGroups,hasTimeKinds,editable,labels,onGroupToggleRef,onGroupSelectRef);
    const groups=timelineGroupsRef.current;
    try{
      if(groups){
        const existingGroupIds=new Set(groups.getIds());
        const wantedGroups=new Set(nextGroups.map(group=>group.id));
        const changedGroups=nextGroups.filter(group=>{
          const old=groups.get(group.id);
          return !old||old.title!==group.title||old.order!==group.order
            ||old.className!==group.className
            ||String(old.content?.textContent??old.content)!==String(group.content?.textContent??group.content);
        });
        if(changedGroups.length)groups.update(changedGroups);
        const previousRowIds=new Set(data.getIds());
        const incoming=new Set(nextRows.map(row=>row.id));
        const obsoleteRows=[...previousRowIds].filter(id=>!incoming.has(id));
        if(obsoleteRows.length)data.remove(obsoleteRows);
        const changedRows=nextRows.filter(row=>{
          const old=data.get(row.id);
          return !old||old.group!==row.group||old.start!==row.start||old.end!==row.end
            ||old.content!==row.content||old.title!==row.title
            ||old.className!==row.className||old.style!==row.style
            ||old.workCount!==row.workCount;
        });
        if(changedRows.length)data.update(changedRows);
        const obsoleteGroups=[...existingGroupIds].filter(id=>!wantedGroups.has(id));
        if(obsoleteGroups.length)groups.remove(obsoleteGroups);
        // A published root can arrive before child rows. DataSet updates alone
        // do not reliably recompute vis-timeline's row geometry after an
        // asynchronous root/child transition. Redraw the existing instance
        // once, preserving its camera and avoiding chart re-creation.
        if(changedGroups.length||changedRows.length||obsoleteRows.length||obsoleteGroups.length){
          timeline.redraw();
        }
      }else if(nextGroups.length){
        const newGroups=new DataSet(nextGroups);
        timeline.setGroups(newGroups);
        timelineGroupsRef.current=newGroups;
        const previousRowIds=new Set(data.getIds());
        data.remove([...previousRowIds].filter(id=>!nextRows.some(row=>row.id===id)));
        data.update(nextRows);
        timeline.redraw();
      }
      // The public river's geometry is owned by vis-timeline itself.
      // Existing dataset mutations above already trigger redraw as needed.
      if(!naturalSourceHeight)
        timeline.setOptions({minHeight:timelineMinHeight+'px',maxHeight:timelineMaxHeight+'px'});
    }catch(error){
      console.error('Culture river in-place group update failed',error);
      setChartError(true);
    }
  },[rows,extraGroups,hasTimeKinds,editable,heightVariant,naturalSourceHeight,preserveTimelineInstance,ready,timelineMinHeight,timelineMaxHeight,labels]);

  // The root total bars arrive after the initial chart has mounted.
  // Repaint the existing chart on the first animation frame after its data update.
  useEffect(()=>{
    if(heightVariant!=='double'||!ready||!rows.some(row=>row.entryType==='source_total'))return;
    let cancelled=false;
    const frame=window.requestAnimationFrame(()=>{
      if(!cancelled&&timelineRef.current)timelineRef.current.redraw();
    });
    return ()=>{cancelled=true;window.cancelAnimationFrame(frame);};
  },[heightVariant,ready,rows]);

  // vis-timeline can accept a DataSet update while its virtualized range
  // items are not yet painted. Detect a genuinely blank numeric river using
  // already-loaded rows and expose the existing accessible list fallback.
  // No additional API/database request is made by this visual health check.
  useEffect(()=>{
    if(heightVariant!=='double'||!ready||!rows.some(row=>row.entryType==='source_total'))return;
    let cancelled=false;
    let frame=0;
    const painted=()=>Array.from(containerRef.current?.querySelectorAll('.vis-item.scope-period-density.vis-range')||[])
      .some(element=>element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0);
    const timer=window.setTimeout(()=>{
      if(cancelled||!timelineRef.current||painted())return;
      // One recovery redraw if a ready timeline has source rows but no bars.
      timelineRef.current.redraw();
      frame=window.requestAnimationFrame(()=>{
        if(!cancelled&&!painted())setChartError(true);
      });
    },350);
    return()=>{cancelled=true;window.clearTimeout(timer);if(frame)window.cancelAnimationFrame(frame);};
  },[heightVariant,ready,rows]);

  // Density analysis is lazy-loaded after first paint. Updating the source
  // river's hidden date ranges must not destroy/recreate the entire chart.
  useEffect(()=>{
    if(heightVariant!=='double'||!ready||appliedHiddenDatesRef.current===hiddenDates)return;
    const timeline=timelineRef.current;
    if(!timeline)return;
    try{
      timeline.setOptions({hiddenDates:Array.isArray(hiddenDates)?hiddenDates:[]});
      appliedHiddenDatesRef.current=hiddenDates;
    }catch(error){
      console.error('Culture river hidden-date update failed',error);
      setChartError(true);
    }
  },[heightVariant,ready,hiddenDates]);

  // One noninteractive time marker extends across every visible group.
  useEffect(()=>{
    const timeline=timelineRef.current;
    if(!ready||!timeline||!anchorInsight?.date)return;
    const markerId='culture-candidate-focus';
    try{timeline.addCustomTime(new Date(anchorInsight.date+'T12:00:00'),markerId);}
    catch{return;}
    return()=>{try{timeline.removeCustomTime(markerId);}catch{/* Already destroyed. */}};
  },[ready,anchorInsight?.date]);

  // Explicit alternatives to gestures, available on touch, mouse, and keyboard.
  function changeWindow(action){
    const timeline=timelineRef.current;
    if(!timeline)return;
    if(action==='zoom-in')return timeline.zoomIn(.35,{animation:cameraAnimation});
    if(action==='zoom-out')return timeline.zoomOut(.35,{animation:cameraAnimation});
    if(action==='reset'){
      if(windowStart&&windowEnd&&Number.isFinite(Date.parse(windowStart))&&Number.isFinite(Date.parse(windowEnd))){
        return timeline.setWindow(windowStart,windowEnd,{animation:cameraAnimation});
      }
      return timeline.fit({animation:cameraAnimation});
    }
    const {start,end}=timeline.getWindow();
    const from=start.getTime(),to=end.getTime();
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return;
    const shift=(to-from)*.35*(action==='later'?1:-1);
    timeline.setWindow(new Date(from+shift),new Date(to+shift),{animation:cameraAnimation});
  }
  function selectFromList(event){
    const row=rows.find(item=>item.id===event.target.value)||null;
    setSelectedRowId(row?.id||'');
    if(row)timelineRef.current?.setSelection([row.id],{focus:true,animation:cameraAnimation});
    onSelectRef.current?.(row);
  }

  if(!rows.length&&!editable&&!extraGroups.length)return <div className='scope-period-timeline-wrap scope-period-timeline-empty'><div className='scope-period-timeline scope-period-timeline-empty-line' role='region' aria-label={t('時間長河')}/><p><FieldText text={mode==='overview'?'尚未設定時期，目前以「所有」總覽顯示。':'目前時期尚無可顯示的時間資料。'}/></p></div>;

  return <div className='scope-period-timeline-wrap'>
    <div className='scope-timeline-controls' role='group' aria-label={t('時間長河操作')}>
      <button type='button' className='loc-button' aria-label={t('往較早時間移動')} disabled={!ready} onClick={()=>changeWindow('earlier')}>←</button>
      <button type='button' className='loc-button' aria-label={t('往較晚時間移動')} disabled={!ready} onClick={()=>changeWindow('later')}>→</button>
      <button type='button' className='loc-button' aria-label={t('放大時間長河')} disabled={!ready} onClick={()=>changeWindow('zoom-in')}>＋</button>
      <button type='button' className='loc-button' aria-label={t('縮小時間長河')} disabled={!ready} onClick={()=>changeWindow('zoom-out')}>－</button>
      <button type='button' className='loc-button' aria-label={t('重置時間長河視野')} disabled={!ready} onClick={()=>changeWindow('reset')}><FieldText text="重置"/></button>
      {onSelect&&!editable?<div className='scope-timeline-focus-slot' aria-live='polite'>
        <AnimatePresence initial={false} mode='wait'>
          {selectedRow?<motion.output key={selectedRow.id}
            className='scope-timeline-focus-pill'
            initial={reduceMotion?false:{opacity:0,x:8}}
            animate={{opacity:1,x:0}} exit={reduceMotion?{opacity:0}:{opacity:0,x:-8}}
            transition={{duration:reduceMotion?0:.2,ease:'easeOut'}}>
            <time dateTime={String(selectedRow.start).slice(0,10)}>{dateLabel(selectedRow.start)}</time>
            <span>{typeof selectedRow.content==='string'?selectedRow.content:String(selectedRow.title||selectedRow.period||'時間紀錄')}</span>
          </motion.output>:null}
        </AnimatePresence>
      </div>:null}
    </div>
    {onSelect&&mode==='overview'&&rows.length<=250?<label className='scope-timeline-item-picker'>
      <span><FieldText text="選擇河道紀錄"/></span>
      <select className='scope-select' aria-label={t('選擇河道紀錄')} value={rows.some(row=>row.id===selectedRowId)?selectedRowId:''} onChange={selectFromList}>
        <option value=''><FieldText text="請選擇日期或紀錄"/></option>
        {rows.map(row=><option key={row.id} value={row.id}>{String(row.start||'').slice(0,10)} · {row.content||row.title||row.entryType||labels.record}</option>)}
      </select>
    </label>:null}
    {chartError?<p className='scope-status' role='alert'><FieldText text="河道已有統計資料，但圖表沒有正常繪製；以下保留日期與筆數清單。"/></p>:null}
    <div className='scope-river-reveal-shell'>
      <div ref={containerRef} data-anchor-gesture={onTimeClick?'double-tap':'none'} className='scope-period-timeline' role='region' aria-label={t(mode==='overview'?'所有時期與定錨點時間長河':'時間長河')} style={naturalSourceHeight?undefined:{'--scope-period-timeline-min-height':timelineMinHeight+'px'}}/>
      {/* An independent curtain reveals the river from left to right after
          vis-timeline is ready. Its geometry, gestures and redraw remain intact. */}
      {ready&&!reduceMotion?<motion.div className='scope-river-unfold-curtain'
        aria-hidden='true' initial={{scaleX:1}} animate={{scaleX:0}}
        transition={{duration:.55,ease:[.22,.8,.2,1]}}/>:null}
    </div>
    <AnimatePresence initial={false}>
      {anchorInsight?<motion.aside key={anchorInsight.date}
        className='scope-candidate-insight' role='status' aria-live='polite'
        initial={reduceMotion?false:{opacity:0,y:8}}
        animate={{opacity:1,y:0}} exit={reduceMotion?{opacity:0}:{opacity:0,y:-6}}
        transition={{duration:reduceMotion?0:.23,ease:'easeOut'}}>
        <button className='scope-candidate-insight-close' type='button' onClick={onAnchorClose} aria-label={anchorLabels?.close||'Close'}>×</button>
        <strong>{anchorLabels?.date||'Date'}：{anchorInsight.date}</strong>
        <div>{anchorLabels?.before||'Before'}：{anchorInsight.before.toLocaleString(locale)} · {anchorLabels?.after||'After'}：{anchorInsight.after.toLocaleString(locale)}</div>
        {anchorInsight.reason?<p>{anchorLabels?.reason||'Reason'}：{anchorInsight.reason}</p>:null}
      </motion.aside>:null}
    </AnimatePresence>
    {chartError?<ol className='scope-list'>
      {fallbackRows.map(row=><li key={row.id}><strong>{row.content}</strong>{row.group?<span> · {groupLabel(row.group)}</span>:null}<span> · {dateLabel(row.start)}</span>{row.title?<p>{row.title}</p>:null}</li>)}
    </ol>:null}
  </div>;
}
