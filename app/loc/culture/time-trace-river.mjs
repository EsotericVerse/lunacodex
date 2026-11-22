// View model for the first Culture Time river.
// Y axis: era, expanded period children.
// X axis: actual anchor.address dates only. Trace rows show separate
// event intervals; expanded child rows show the real endpoint anchor points.
// Neither a single anchor nor multiple disjoint events imply an open range.
const text=value=>String(value||'').trim();
const list=value=>Array.isArray(value)?value:[];
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0,10));
const uniqueByUid=rows=>{
  const byUid=new Map();
  for(const row of list(rows)){
    const key=text(row?.scope_id)+':'+text(row?.uid);
    if(row?.uid&&!byUid.has(key))byUid.set(key,row);
  }
  return [...byUid.values()];
};
// Public Scope Culture follows the same unclassified-date rule as the edit
// river. Classification depends on ALL era/period windows, never expansion.
// A date outside every actual interval must not be assigned to an era envelope.
export function unassignedPublicDateAnchors(dates,eraWindows){
  const windows=list(eraWindows).filter(range=>
    validDate(range?.start)&&validDate(range?.end)&&range.start<=range.end);
  return list(dates).filter(anchor=>{
    const day=text(anchor?.date).slice(0,10);
    return validDate(day)&&!windows.some(range=>range.start<=day&&day<=range.end);
  });
}

export function buildEraRiver(source=[],expandedEraIds=[],{editorOnly=false,scopeId=''}={}){
  const traces=uniqueByUid(source.filter(row=>row?.entry_type==='era'));
  const events=new Map(uniqueByUid(source.filter(row=>row?.entry_type==='period'))
    .map(row=>[text(row.scope_id)+':'+text(row.uid),row]));
  const anchors=new Map(uniqueByUid(source.filter(row=>row?.entry_type==='anchor'))
    .map(row=>[text(row.scope_id)+':'+text(row.uid),row]));
  const expanded=new Set(list(expandedEraIds).map(text));
  const items=[],groups=[];
  const datedAnchors=[...anchors.values()]
    .filter(anchor=>validDate(anchor.start_date))
    .sort((a,b)=>text(a.start_date).localeCompare(text(b.start_date)));
  const assigned=new Set();
  const withinTrace=(anchor,trace)=>{
    if(text(anchor.scope_id)!==text(trace.scope_id))return false;
    const day=text(anchor.start_date).slice(0,10);
    const spans=list(trace.ranges).length?trace.ranges:[trace];
    return spans.some(range=>{
      const start=text(range?.start_date).slice(0,10);
      const end=text(range?.end_date||range?.start_date).slice(0,10);
      return validDate(start)&&validDate(end)&&start<=day&&day<=end
        &&end>=start&&(!range?.invalid||range?.point);
    });
  };
  if(editorOnly){
    // Match the public Culture first river: one era lane (with actual date
    // anchors), nested period lanes only after the era's (+) is opened.
    // Keep the original record UID for selecting an item to edit.
    for(const [traceIndex,trace] of traces.entries()){
      const scope=text(trace.scope_id),uid=text(trace.uid);
      const groupId='trace:'+scope+':'+uid;
      const isExpanded=expanded.has(groupId);
      const order=traceIndex*10000;
      groups.push({id:groupId,label:text(trace.title)||'時代 '+uid,
        collapsible:true,expanded:isExpanded,order,
        className:'scope-time-trace-parent'});
      const spans=list(trace.ranges).length?trace.ranges:[trace];
      for(const [segment,range] of spans.entries()){
        const from=text(range?.start_date).slice(0,10);
        const until=text(range?.end_date||range?.start_date).slice(0,10);
        if(!validDate(from)||range?.invalid)continue;
        items.push({id:groupId+':era:'+segment,uid,scope_id:scope,
          entry_type:'era',group_key:groupId,group_label:trace.title||'時代',
          group_order:order,start_date:from,
          ...(validDate(until)&&until>from?{end_date:until}:{}),
          title:trace.title||'時代',display_label:trace.title||'時代'});
      }
      if(!isExpanded)continue;
      const seen=new Set();
      for(const [position,eventId] of list(trace.anchor_ids).map(text).entries()){
        if(!eventId||seen.has(eventId))continue;
        seen.add(eventId);
        const event=events.get(scope+':'+eventId);
        const periodGroup=groupId+':period:'+eventId;
        groups.push({id:periodGroup,order:order+position+1,
          label:'　'+(event?.title||'期間 '+eventId),
          className:'scope-time-trace-child'});
        if(!event)continue;
        const ranges=list(event.ranges).length?event.ranges:[event];
        for(const [segment,range] of ranges.entries()){
          const from=text(range?.start_date).slice(0,10);
          const until=text(range?.end_date||range?.start_date).slice(0,10);
          if(!validDate(from)||range?.invalid)continue;
          items.push({id:periodGroup+':'+segment,uid:eventId,scope_id:scope,
            entry_type:'period',group_key:periodGroup,
            group_label:event.title||'期間',group_order:order+position+1,
            start_date:from,
            ...(validDate(until)&&until>from?{end_date:until}:{}),
            title:event.title||'期間',display_label:event.title||'期間',
            era_uid:uid,period_uid:eventId});
        }
      }
      const points=datedAnchors.filter(anchor=>withinTrace(anchor,trace));
      const dateGroup=groupId+':anchors';
      if(points.length)groups.push({id:dateGroup,label:'　定錨點',
        order:order+9000,className:'scope-time-trace-child'});
      for(const anchor of points){
        const pointUid=text(anchor.uid);
        items.push({id:groupId+':date:'+pointUid,uid:pointUid,scope_id:scope,
          entry_type:'anchor',group_key:dateGroup,group_label:'定錨點',
          group_order:order+9000,start_date:text(anchor.start_date).slice(0,10),
          title:anchor.title||pointUid,display_label:'●',
          class_name:'scope-time-original-anchor'});
      }
    }
    // Every Scope has a final unclassified lane on the management river.
    // Date anchors outside all Era ranges remain selectable/editable.
    const unassigned=datedAnchors.filter(anchor=>
      !traces.some(trace=>withinTrace(anchor,trace)));
    const scopeIds=[...new Set([text(scopeId),...source.map(row=>text(row?.scope_id)).filter(Boolean),
      ...unassigned.map(anchor=>text(anchor.scope_id))].filter(Boolean))];
    for(const [index,scope] of scopeIds.entries()){
      const groupId='time-undefined:'+scope;
      groups.push({id:groupId,label:'未定義',order:(traces.length+1)*10000+index,
        className:'scope-time-anchor-parent'});
      for(const anchor of unassigned.filter(row=>text(row.scope_id)===scope)){
        const uid=text(anchor.uid);
        items.push({id:groupId+':'+uid,uid,scope_id:scope,
          entry_type:'anchor',group_key:groupId,group_label:'未定義',
          group_order:(traces.length+1)*10000+index,
          start_date:text(anchor.start_date).slice(0,10),
          title:anchor.title||uid,display_label:'●',
          class_name:'scope-time-original-anchor'});
      }
    }
    return {items,groups};
  }
  for(const [traceIndex,trace] of traces.entries()){
    const scope=text(trace.scope_id),id=text(trace.uid);
    const groupId='trace:'+scope+':'+id;
    const isExpanded=expanded.has(groupId);
    const eventIds=list(trace.anchor_ids).map(text).filter(Boolean);
    groups.push({id:groupId,label:text(trace.title)||'時代 '+id,
      collapsible:true,expanded:isExpanded,order:traceIndex*10000,
      className:'scope-time-trace-parent'});
    // Always paint real era ranges on the parent lane. A collapsed era
    // previously produced a group without any vis-timeline items.
    const spans=list(trace.ranges).length?trace.ranges:[trace];
    for(const [segment,range] of spans.entries()){
      const from=text(range?.start_date).slice(0,10);
      const until=text(range?.end_date||range?.start_date).slice(0,10);
      if(!validDate(from))continue;
      const hasValidEnd=validDate(until)&&until>from&&!range?.invalid;
      items.push({id:groupId+':era:'+segment,
        uid:id,scope_id:scope,entry_type:'era',
        group_key:groupId,group_label:trace.title||'時代',
        group_order:traceIndex*10000,start_date:from,
        ...(hasValidEnd?{end_date:until}:{}),
        title:trace.title||'時代',
        display_label:range?.point?'●':'',
        ...(range?.invalid?{class_name:'scope-time-trace-broken'}:{})});
    }
    const traceAnchors=datedAnchors.filter(anchor=>withinTrace(anchor,trace));
    for(const anchor of traceAnchors)assigned.add(scope+':'+text(anchor.uid));
    if(!isExpanded)continue;
    const seenEvents=new Set();
    for(const [position,eventId] of eventIds.entries()){
      // A repeated link is a single event, not duplicated work/density.
      if(seenEvents.has(eventId))continue;
      seenEvents.add(eventId);
      const event=events.get(scope+':'+eventId);
      const eventGroup='trace-event:'+scope+':'+id+':'+eventId;
      groups.push({id:eventGroup,order:traceIndex*10000+position+2,
        label:'期間｜'+(event?.title||'失效連線 '+eventId),
        className:'scope-time-trace-child'});
      if(!event)continue;
      const slices=list(event.ranges).length?event.ranges:[event];
      for(const [segment,range] of slices.entries()){
        const from=text(range?.start_date).slice(0,10);
        if(!validDate(from))continue;
        const until=text(range?.end_date).slice(0,10);
        const validEnd=validDate(until)&&until>from&&!range.invalid;
        // Main trace lane uses only the true event interval, never an
        // envelope spanning different events and never a fake now endpoint.
        items.push({id:groupId+':'+eventId+':'+segment+':period',
          uid:event.uid,scope_id:scope,entry_type:'period',
          group_key:eventGroup,group_label:event.title||eventId,
          start_date:from,...(validEnd?{end_date:until}:{}),
          display_label:event.title||eventId,title:event.title||eventId,
          description:event.summary||event.description||'',
          era_uid:id,period_uid:eventId,
          invalid_anchor_links:range.missing_anchor_ids||[],
          group_order:traceIndex*10000+position+2,
          ...(range.invalid?{class_name:'scope-time-trace-broken'}:{})});
        const references=editorOnly?[]:[range.start_anchor_id,range.end_anchor_id]
          .filter(Boolean).map(text);
        const seenAnchors=new Set();
        for(const anchorId of references){
          if(seenAnchors.has(anchorId))continue;
          seenAnchors.add(anchorId);
          const anchor=anchors.get(scope+':'+anchorId);
          const date=text(anchor?.start_date).slice(0,10);
          if(!validDate(date))continue;
          items.push({id:eventGroup+':'+segment+':'+anchorId,
            uid:anchor.uid,scope_id:scope,entry_type:'anchor',
            group_key:eventGroup,group_label:event.title,
            start_date:date,display_label:anchor.title||anchorId,
            title:anchor.title||anchorId,
            description:anchor.summary||anchor.description||'',
            era_uid:id,period_uid:eventId,
            group_order:traceIndex*10000+position+2});
        }
      }
    }
    const anchorGroup='trace-anchors:'+scope+':'+id;
    if(traceAnchors.length)groups.push({id:anchorGroup,label:'定錨點',
      order:traceIndex*10000+9000,className:'scope-time-trace-child'});
    for(const anchor of traceAnchors){
      const anchorId=text(anchor.uid),title=text(anchor.title)||anchorId;
      items.push({id:groupId+':anchor:'+anchorId,
        uid:anchorId,scope_id:scope,entry_type:'anchor',
        group_key:anchorGroup,group_label:'定錨點',
        group_order:traceIndex*10000+9000,
        start_date:text(anchor.start_date).slice(0,10),
        display_label:'●',title,
        class_name:'scope-time-original-anchor',
        description:anchor.summary||anchor.description||''});
    }
  }
  const unassigned=datedAnchors.filter(anchor=>
    !assigned.has(text(anchor.scope_id)+':'+text(anchor.uid)));
  const scopes=[...new Set([text(scopeId),...source.map(row=>text(row?.scope_id)).filter(Boolean),
    ...unassigned.map(anchor=>text(anchor.scope_id))].filter(Boolean))];
  for(const [index,scope] of scopes.entries()){
    const groupId='time-undefined:'+scope;
    const label='未定義';
    const isExpanded=expanded.has(groupId);
    groups.push({id:groupId,label,order:(traces.length+1)*10000+index,
      collapsible:true,expanded:isExpanded,className:'scope-time-anchor-parent'});
    for(const anchor of unassigned.filter(row=>text(row.scope_id)===scope)){
      const uid=text(anchor.uid),title=text(anchor.title)||uid;
      items.push({id:groupId+':'+uid,uid,scope_id:scope,entry_type:'anchor',
        group_key:groupId,group_label:label,
        group_order:(traces.length+1)*10000+index,
        start_date:text(anchor.start_date).slice(0,10),
        display_label:isExpanded?title:'●',title,
        class_name:'scope-time-original-anchor',
        description:anchor.summary||anchor.description||''});
    }
  }
  return {items,groups};
}
