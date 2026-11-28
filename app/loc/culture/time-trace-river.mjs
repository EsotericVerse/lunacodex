// View model for the first Culture Time river.
// Y axis: era, expanded period children.
// X axis: actual lucus.address dates only. Trace rows show separate
// event intervals; expanded child rows show the real endpoint lucus points.
// Neither a single lucus nor multiple disjoint events imply an open range.
const text=value=>String(value||'').trim();
const list=value=>Array.isArray(value)?value:[];
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0,10));
// Real chronological placement for the Y-axis. SQL may return UIDs in any
// order, and the saved Era/Period UID links are relations, NOT sort keys.
const firstRangeDate=row=>{
  const ranges=list(row?.ranges).length?row.ranges:[row];
  return ranges.filter(range=>!range?.invalid||range?.point)
    .map(range=>text(range?.start_date).slice(0,10))
    .filter(validDate).sort()[0]||'9999-12-31';
};
const chronological=(a,b)=>firstRangeDate(a).localeCompare(firstRangeDate(b))||
  text(a?.scope_id).localeCompare(text(b?.scope_id))||
  text(a?.uid).localeCompare(text(b?.uid));
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
  return list(dates).filter(lucus=>{
    const day=text(lucus?.date).slice(0,10);
    return validDate(day)&&!windows.some(range=>range.start<=day&&day<=range.end);
  });
}

// A management drill-down follows ONE open branch: Era -> Period -> Dates.
// Opening another Era closes the previous Periods and dates. This controls
// display only; it does not rewrite the saved Era/Period UID relationships.
export function nextEditorEraExpansion(current=[],selectedGroupId=''){
  const id=text(selectedGroupId);
  const open=new Set(list(current).map(text));
  if(id.startsWith('time-undefined:'))
    return open.has(id)?[]:[id];
  if(!id.startsWith('trace:'))return [];
  const periodOffset=id.indexOf(':period:');
  if(periodOffset!==-1){
    const eraId=id.slice(0,periodOffset);
    return open.has(id)?[eraId]:[eraId,id];
  }
  return open.has(id)?[]:[id];
}

export function buildEraRiver(source=[],expandedEraIds=[],{editorOnly=false,scopeId=''}={}){
  const traces=uniqueByUid(source.filter(row=>row?.entry_type==='era'))
    .sort(chronological);
  const events=new Map(uniqueByUid(source.filter(row=>row?.entry_type==='period'))
    .map(row=>[text(row.scope_id)+':'+text(row.uid),row]));
  const anchors=new Map(uniqueByUid(source.filter(row=>row?.entry_type==='lucus'))
    .map(row=>[text(row.scope_id)+':'+text(row.uid),row]));
  const orderedPeriodIds=(trace,scope)=>
    [...new Set(list(trace.anchor_ids).map(text).filter(Boolean))]
      .sort((a,b)=>chronological(
        events.get(scope+':'+a)||{scope_id:scope,uid:a},
        events.get(scope+':'+b)||{scope_id:scope,uid:b}));
  const expanded=new Set(list(expandedEraIds).map(text));
  const items=[],groups=[];
  const datedAnchors=[...anchors.values()]
    .filter(lucus=>validDate(lucus.start_date))
    .sort((a,b)=>text(a.start_date).localeCompare(text(b.start_date)));
  const assigned=new Set();
  const withinTrace=(lucus,trace)=>{
    if(text(lucus.scope_id)!==text(trace.scope_id))return false;
    const day=text(lucus.start_date).slice(0,10);
    const spans=list(trace.ranges).length?trace.ranges:[trace];
    return spans.some(range=>{
      const start=text(range?.start_date).slice(0,10);
      const end=text(range?.end_date||range?.start_date).slice(0,10);
      return validDate(start)&&validDate(end)&&start<=day&&day<=end
        &&end>=start&&(!range?.invalid||range?.point);
    });
  };
  if(editorOnly){
    // Management uses the same collapsed Era hierarchy as public Culture.
    // A collapsed Era may paint its own interval, but MUST NOT instantiate
    // every Period/Date lane. Each Period expands its dates independently.
    // All rows come from the existing authorized snapshot: no extra SQL.
    let groupOrder=0;
    const addGroup=group=>{
      const ordered={...group,order:groupOrder++};
      groups.push(ordered);
      return ordered.order;
    };
    const assignedToPeriod=new Set();
    for(const trace of traces){
      const scope=text(trace.scope_id),uid=text(trace.uid);
      const groupId='trace:'+scope+':'+uid;
      const isExpanded=expanded.has(groupId);
      const eraOrder=addGroup({id:groupId,label:text(trace.title)||'時代 '+uid,
        collapsible:true,expanded:isExpanded,
        className:'scope-time-trace-parent'});
      const spans=list(trace.ranges).length?trace.ranges:[trace];
      for(const [segment,range] of spans.entries()){
        const from=text(range?.start_date).slice(0,10);
        const until=text(range?.end_date||range?.start_date).slice(0,10);
        if(!validDate(from)||range?.invalid)continue;
        items.push({id:groupId+':era:'+segment,uid,scope_id:scope,
          entry_type:'era',group_key:groupId,group_label:trace.title||'時代',
          group_order:eraOrder,start_date:from,
          ...(validDate(until)&&until>from?{end_date:until}:{}),
          title:trace.title||'時代',display_label:trace.title||'時代'});
      }
      for(const eventId of orderedPeriodIds(trace,scope)){
        const event=events.get(scope+':'+eventId);
        // Determine membership without rendering the collapsed child nodes.
        // One real Date can belong to multiple saved Periods and Eras.
        const eventPoints=event?datedAnchors.filter(lucus=>withinTrace(lucus,event)):[];
        for(const point of eventPoints)assignedToPeriod.add(text(point.scope_id)+':'+text(point.uid));
        if(!isExpanded)continue;
        const periodGroup=groupId+':period:'+eventId;
        const periodExpanded=expanded.has(periodGroup);
        const periodOrder=addGroup({id:periodGroup,
          label:'期間｜'+(event?.title||'失效期間 '+eventId),
          collapsible:Boolean(event),expanded:periodExpanded,depth:1,
          className:'scope-time-trace-child'});
        if(!event)continue;
        const ranges=list(event.ranges).length?event.ranges:[event];
        for(const [segment,range] of ranges.entries()){
          const from=text(range?.start_date).slice(0,10);
          const until=text(range?.end_date||range?.start_date).slice(0,10);
          if(!validDate(from)||range?.invalid)continue;
          items.push({id:periodGroup+':'+segment,uid:eventId,scope_id:scope,
            entry_type:'period',group_key:periodGroup,
            group_label:event.title||'期間',group_order:periodOrder,
            start_date:from,
            ...(validDate(until)&&until>from?{end_date:until}:{}),
            title:event.title||'期間',display_label:event.title||'期間',
            era_uid:uid,period_uid:eventId});
        }
        if(!periodExpanded||!eventPoints.length)continue;
        const dateGroup=periodGroup+':dates';
        const dateOrder=addGroup({id:dateGroup,label:'定錨點',depth:2,
          className:'scope-time-trace-child'});
        for(const lucus of eventPoints){
          const pointUid=text(lucus.uid);
          items.push({id:dateGroup+':'+pointUid,uid:pointUid,scope_id:scope,
            entry_type:'lucus',group_key:dateGroup,group_label:'定錨點',
            group_order:dateOrder,start_date:text(lucus.start_date).slice(0,10),
            title:lucus.title||pointUid,display_label:'●',
            era_uid:uid,period_uid:eventId,
            class_name:'scope-time-original-lucus'});
        }
      }
    }
    // Only dates without any actual linked Era -> Period membership belong
    // at the very end. Keep their records available, but do not render the
    // entire unclassified list until the visitor opens it.
    const unassigned=datedAnchors.filter(lucus=>
      !assignedToPeriod.has(text(lucus.scope_id)+':'+text(lucus.uid)));
    // The last root is ALWAYS "未定義定錨", even when it currently has no
    // orphan dates. It stays collapsed until explicitly opened. Keep Scope
    // identity in its UID so a previous Scope cannot show another's dates.
    const scopes=[...new Set([text(scopeId),...unassigned.map(lucus=>
      text(lucus.scope_id))].filter(Boolean))];
    for(const scope of scopes){
      const groupId='time-undefined:'+scope;
      const isExpanded=expanded.has(groupId);
      const order=addGroup({id:groupId,label:'未定義定錨',
        collapsible:true,expanded:isExpanded,
        className:'scope-time-lucus-parent'});
      if(!isExpanded)continue;
      for(const lucus of unassigned.filter(row=>text(row.scope_id)===scope)){
        const uid=text(lucus.uid);
        items.push({id:groupId+':'+uid,uid,scope_id:scope,
          entry_type:'lucus',group_key:groupId,group_label:'未定義定錨',
          group_order:order,start_date:text(lucus.start_date).slice(0,10),
          title:lucus.title||uid,display_label:'●',
          class_name:'scope-time-original-lucus'});
      }
    }
    return {items,groups};
  }

  for(const [traceIndex,trace] of traces.entries()){
    const scope=text(trace.scope_id),id=text(trace.uid);
    const groupId='trace:'+scope+':'+id;
    const isExpanded=expanded.has(groupId);
    const eventIds=orderedPeriodIds(trace,scope);
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
    const traceAnchors=datedAnchors.filter(lucus=>withinTrace(lucus,trace));
    for(const lucus of traceAnchors)assigned.add(scope+':'+text(lucus.uid));
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
          const lucus=anchors.get(scope+':'+anchorId);
          const date=text(lucus?.start_date).slice(0,10);
          if(!validDate(date))continue;
          items.push({id:eventGroup+':'+segment+':'+anchorId,
            uid:lucus.uid,scope_id:scope,entry_type:'lucus',
            group_key:eventGroup,group_label:event.title,
            start_date:date,display_label:lucus.title||anchorId,
            title:lucus.title||anchorId,
            description:lucus.summary||lucus.description||'',
            era_uid:id,period_uid:eventId,
            group_order:traceIndex*10000+position+2});
        }
      }
    }
    const anchorGroup='trace-anchors:'+scope+':'+id;
    if(traceAnchors.length)groups.push({id:anchorGroup,label:'定錨點',
      order:traceIndex*10000+9000,className:'scope-time-trace-child'});
    for(const lucus of traceAnchors){
      const anchorId=text(lucus.uid),title=text(lucus.title)||anchorId;
      items.push({id:groupId+':lucus:'+anchorId,
        uid:anchorId,scope_id:scope,entry_type:'lucus',
        group_key:anchorGroup,group_label:'定錨點',
        group_order:traceIndex*10000+9000,
        start_date:text(lucus.start_date).slice(0,10),
        display_label:'●',title,
        class_name:'scope-time-original-lucus',
        description:lucus.summary||lucus.description||''});
    }
  }
  const unassigned=datedAnchors.filter(lucus=>
    !assigned.has(text(lucus.scope_id)+':'+text(lucus.uid)));
  const scopes=[...new Set([text(scopeId),...source.map(row=>text(row?.scope_id)).filter(Boolean),
    ...unassigned.map(lucus=>text(lucus.scope_id))].filter(Boolean))];
  for(const [index,scope] of scopes.entries()){
    const groupId='time-undefined:'+scope;
    const label='未定義';
    const isExpanded=expanded.has(groupId);
    groups.push({id:groupId,label,order:(traces.length+1)*10000+index,
      collapsible:true,expanded:isExpanded,className:'scope-time-lucus-parent'});
    for(const lucus of unassigned.filter(row=>text(row.scope_id)===scope)){
      const uid=text(lucus.uid),title=text(lucus.title)||uid;
      items.push({id:groupId+':'+uid,uid,scope_id:scope,entry_type:'lucus',
        group_key:groupId,group_label:label,
        group_order:(traces.length+1)*10000+index,
        start_date:text(lucus.start_date).slice(0,10),
        display_label:isExpanded?title:'●',title,
        class_name:'scope-time-original-lucus',
        description:lucus.summary||lucus.description||''});
    }
  }
  return {items,groups};
}
