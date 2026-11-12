'use client';

import {parseRuneKeywordRuleSentence} from './rune-keyword-rules.mjs';
import {compileKeywordLiteralMatcher} from '../keyword-literal-matcher.mjs';

function normalizeText(value){
  return String(value??'').normalize('NFKC').toLocaleLowerCase('zh-Hant').trim();
}

function compareRank(a,b){
  return Number(b.count||0)-Number(a.count||0)
    ||Number(a.order||0)-Number(b.order||0)
    ||String(a.label||'').localeCompare(String(b.label||''));
}

// Keyword/rune matching only looks at the article body. Title text used to
// be folded in here too, so a keyword appearing only in the title (never in
// the content) would still count -- not the intended behavior, so title is
// deliberately excluded now.
function textOf(row){
  return String(row?.content||'');
}

function keywordList(value){
  if(Array.isArray(value))return value.map(item=>String(item||'').trim()).filter(Boolean);
  if(typeof value==='string'){
    try{
      const parsed=JSON.parse(value);
      if(Array.isArray(parsed))return parsed.map(item=>String(item||'').trim()).filter(Boolean);
    }catch{}
  }
  return [];
}

function compileCatalog(catalogRows=[]){
  const nameToRune=new Map();
  const groupOrder=new Map();
  const runes=[];

  for(const row of catalogRows){
    const runeId=Number(row?.item_no);
    if(!Number.isSafeInteger(runeId)||runeId<0)continue;
    const label=String(row?.item_name||'').trim();
    const group=String(row?.class_group||'').trim();
    if(!label||!group)continue;
    const order=Number.isFinite(Number(row?.order_no))?Number(row.order_no):runeId;
    const classEnable=row?.class_enable!==false;
    nameToRune.set(label,runeId);
    if(!groupOrder.has(group))groupOrder.set(group,order);
    else groupOrder.set(group,Math.min(groupOrder.get(group),order));

    const keywords=[];
    const rules=[];
    const notes=[];
    for(const value of keywordList(row?.keywords)){
      const parsed=parseRuneKeywordRuleSentence(value);
      if(parsed.rules.length){
        rules.push(...parsed.rules);
        notes.push(...parsed.notes);
      }else{
        keywords.push(value);
      }
    }

    runes.push({
      runeId,
      name:label,
      label,
      group,
      order,
      classEnable,
      principle:String(row?.principle||'').trim(),
      keywords:[...new Set([label,...keywords].filter(Boolean))],
      rules:rules.filter((rule,index,all)=>all.findIndex(other=>
        other.operator===rule.operator&&other.source===rule.source&&other.target===rule.target
      )===index),
      notes:[...new Set(notes)]
    });
  }

  runes.sort((a,b)=>a.order-b.order||a.runeId-b.runeId);
  const disabledGroups=[...new Set(runes.filter(rune=>rune.classEnable===false).map(rune=>rune.group).filter(Boolean))];
  const fallbackGroup=disabledGroups.length===1?disabledGroups[0]:'';
  return {runes,nameToRune,groupOrder,fallbackGroup};
}

function replaceAllLiteral(source,needle,replacement=' '){
  if(!needle)return source;
  return source.split(needle).join(replacement);
}

function createState(){
  return {
    hitCount:0,
    runeCounts:new Map(),
    groupCounts:new Map(),
    classGroupCounts:new Map(),
    seen:new Set()
  };
}

function signalLength(value){
  return Array.from(String(value||'')).length;
}

function increment(state,rune,signal,signalChars=0){
  if(!state||!rune)return;
  const key=String(rune.runeId)+'\u0000'+String(signal||'');
  if(state.seen.has(key))return;
  state.seen.add(key);
  state.hitCount+=1;

  const existingRune=state.runeCounts.get(rune.runeId);
  const runeCount=existingRune||{
    key:String(rune.runeId),
    rune_id:rune.runeId,
    label:rune.label||rune.name,
    group:rune.group,
    order:rune.order,
    count:0,
    signal_chars:0
  };
  runeCount.count+=1;
  runeCount.signal_chars+=Number(signalChars)||0;
  state.runeCounts.set(rune.runeId,runeCount);

  if(rune.group){
    const groupCount=state.groupCounts.get(rune.group)||{
      key:rune.group,
      label:rune.group,
      order:rune.order,
      count:0,
      signal_chars:0
    };
    groupCount.count+=1;
    groupCount.signal_chars+=Number(signalChars)||0;
    groupCount.order=Math.min(groupCount.order,rune.order);
    state.groupCounts.set(rune.group,groupCount);

    if(rune.classEnable!==false){
      const classGroupCount=state.classGroupCounts.get(rune.group)||{
        key:rune.group,
        label:rune.group,
        order:rune.order,
        count:0,
        signal_chars:0
      };
      classGroupCount.count+=1;
      classGroupCount.signal_chars+=Number(signalChars)||0;
      classGroupCount.order=Math.min(classGroupCount.order,rune.order);
      state.classGroupCounts.set(rune.group,classGroupCount);
    }
  }
}

function maskCalendarDateLiterals(source){
  return String(source||'')
    .replace(/(?:\d{2,4}年)?\d{1,2}月\d{1,2}日/gu,' ')
    .replace(/(?:[〇零一二三四五六七八九十百]{2,4}年)?[〇零一二三四五六七八九十]{1,3}月[〇零一二三四五六七八九十廿卅]{1,3}日/gu,' ');
}

function specialRuneKeywordTexts(normalizedTexts,runes,rune){
  const ruleEntries=runes.flatMap(item=>item.rules.map(rule=>({item,rule})));

  const nameSources=ruleEntries
    .filter(({rule})=>rule.operator==='NAME')
    .map(({rule})=>normalizeText(rule.source))
    .filter(Boolean);

  const dayMoonTargetSources=ruleEntries
    .filter(({rule})=>{
      const source=normalizeText(rule.source);
      if(!source||!(source.includes('日')||source.includes('月')))return false;
      return (rule.operator==='TO'||rule.operator==='AND')
        &&normalizeText(rule.target)===normalizeText(rune.label);
    })
    .map(({rule})=>normalizeText(rule.source))
    .filter(Boolean);

  const dayMoonSources=(rune.label==='日'||rune.label==='月')
    ?ruleEntries
      .filter(({rule})=>rule.operator==='AND'||rule.operator==='TO')
      .map(({rule})=>normalizeText(rule.source))
      .filter(source=>source&&source.includes(normalizeText(rune.label)))
    :[];

  const sources=[...new Set([...nameSources,...dayMoonTargetSources,...dayMoonSources])]
    .sort((a,b)=>b.length-a.length);

  return normalizedTexts.map(source=>{
    let text=source||'';
    if(rune.label==='日'||rune.label==='月')text=maskCalendarDateLiterals(text);
    for(const ruleSource of sources)text=replaceAllLiteral(text,ruleSource,' ');
    return text;
  });
}

// Reanalysis keeps one immutable compiled Class for every article page.
// Public one-off calls retain the existing API and identical scoring behavior.
export function createKeywordDocumentClassifier(catalogRows=[],{collectKeywordTerms=false,selectedTerms=null}={}){
  const prepared=compileCatalog(catalogRows);
  const selected=selectedTerms==null?null:new Set([...selectedTerms].map(normalizeText));
  const literalMatcher=selected?compileKeywordLiteralMatcher([...selected]):null;
  return documents=>classifyKeywordDocumentsWithCompiled(
    documents,prepared,collectKeywordTerms,selected,literalMatcher);
}
export function classifyKeywordDocuments(documents=[],catalogRows=[]){
  return classifyKeywordDocumentsWithCompiled(documents,compileCatalog(catalogRows));
}
function classifyKeywordDocumentsWithCompiled(documents=[],prepared,collectKeywordTerms=false,selectedTerms=null,literalMatcher=null){
  const source=Array.isArray(documents)?documents:[];
  const {runes,nameToRune,groupOrder,fallbackGroup}=prepared;
  if(!source.length||!runes.length)return {
    documentCount:source.length,
    classifiedCount:0,
    unclassifiedCount:source.length,
    tieCount:0,
    classifications:[],
    runeTotals:[],
    runeRanking:[],
    groupTotals:[],
    unsupportedRules:[]
  };

  const normalizedTexts=source.map(row=>normalizeText(textOf(row)));
  // Incremental word lookups only need to evaluate articles containing at
  // least one selected literal. Item NOR/NAME/TO/AND and masking still run
  // through the original rule-preserving evaluator for those articles.
  const candidateWordsByDocument=literalMatcher
    ?normalizedTexts.map(text=>literalMatcher.matched(text)):null;

  const states=source.map(()=>createState());
  // Reanalysis optionally collects exactly the literal words that matched
  // this article. The original Item scoring is unchanged.
  const termMatches=collectKeywordTerms?source.map(()=>new Set()):null;
  const runeById=new Map(runes.map(rune=>[rune.runeId,rune]));
  const unsupportedRules=[];

  for(const rune of runes){
    let relevantIndices=null;
    if(selectedTerms){
      const words=rune.keywords.map(normalizeText)
        .filter(word=>word&&selectedTerms.has(word));
      if(!words.length)continue;
      // The existing NAME/NOR/date masking replaces text with spaces. It
      // can create a newly adjacent *whitespace-containing* literal (e.g.
      // "dark jazz" from "darknoisejazz"). Such words must be evaluated
      // by the original classifier even if absent from the raw Aho scan.
      if(!words.some(word=>/\s/u.test(word))){
        relevantIndices=[];
        for(let index=0;index<normalizedTexts.length;index++)
          if(words.some(word=>candidateWordsByDocument[index].has(word)))
            relevantIndices.push(index);
        if(!relevantIndices.length)continue;
      }
    }
    // NOR excludes the exact combined expression for this Item, across all
    // of its matching words. Other independent occurrences remain countable.
    const blockedPhrases=[...new Set(rune.rules
      .filter(rule=>rule.operator==='NOR')
      .map(rule=>normalizeText(rule.source)+normalizeText(rule.target))
      .filter(Boolean))].sort((a,b)=>b.length-a.length);
    const withoutBlockedPhrases=source=>{
      let value=source;
      for(const phrase of blockedPhrases)value=replaceAllLiteral(value,phrase,' ');
      return value;
    };
    const keywordTexts=specialRuneKeywordTexts(
      relevantIndices?relevantIndices.map(index=>normalizedTexts[index]):normalizedTexts,
      runes,rune).map(withoutBlockedPhrases);
    const ruleTexts=selectedTerms?[]:normalizedTexts.map(withoutBlockedPhrases);
    const orderedRules=(selectedTerms?[]:[...rune.rules]).sort((a,b)=>
      normalizeText(b.source).length-normalizeText(a.source).length
      ||String(a.token||'').localeCompare(String(b.token||''))
    );

    for(const keyword of rune.keywords){
      const normalizedKeyword=normalizeText(keyword);
      if(!normalizedKeyword||selectedTerms&&!selectedTerms.has(normalizedKeyword))continue;
      const isDayMoonName=(rune.label==='日'||rune.label==='月')&&normalizedKeyword===normalizeText(rune.label);
      const ownSpecificSources=isDayMoonName
        ?rune.keywords
          .map(normalizeText)
          .filter(source=>source&&source!==normalizedKeyword&&source.includes(normalizedKeyword))
          .sort((a,b)=>b.length-a.length)
        :[];
      for(let localIndex=0;localIndex<keywordTexts.length;localIndex+=1){
        const index=relevantIndices?relevantIndices[localIndex]:localIndex;
        if(selectedTerms&&!/\s/u.test(normalizedKeyword)&&
          !candidateWordsByDocument[index].has(normalizedKeyword))continue;
        if(!states[index])continue;
        let text=keywordTexts[localIndex]||'';
        if(isDayMoonName){
          for(const source of ownSpecificSources)text=replaceAllLiteral(text,source,' ');
        }
        if(!text.includes(normalizedKeyword))continue;
        if(termMatches)termMatches[index].add(normalizedKeyword);
        increment(states[index],rune,'keyword:'+normalizedKeyword,signalLength(normalizedKeyword));
      }
    }

    // Incremental word lookup has no need for Item scoring or rule routing.
    if(selectedTerms)continue;
    for(const rule of orderedRules){
      if(rule.operator==='NOR')continue; // applied before Item and rule matching
      const ruleSource=normalizeText(rule.source);
      if(!ruleSource)continue;
      const targetId=rule.operator==='NAME'?null:nameToRune.get(String(rule.target||'').trim());
      const target=targetId?runeById.get(Number(targetId)):null;
      if(rule.operator!=='NAME'&&!target){
        unsupportedRules.push({rune_id:rune.runeId,rune:rune.label,rule:rule.token});
        continue;
      }
      for(let index=0;index<normalizedTexts.length;index+=1){
        if(!states[index])continue;
        const remaining=ruleTexts[index]||'';
        if(!remaining.includes(ruleSource))continue;

        ruleTexts[index]=replaceAllLiteral(remaining,ruleSource,' ');

        if(rule.operator==='NAME')continue;
        if(rule.operator==='AND'){
          // The source is already counted by its Item's literal keywords
          // when applicable; AND adds one target association, not a
          // duplicate source hit.
          if(!states[index].runeCounts.has(rune.runeId))
            increment(states[index],rune,'rule:'+rule.token+':source',signalLength(ruleSource));
          increment(states[index],target,'rule:'+rule.token+':target',signalLength(ruleSource));
        }else if(rule.operator==='TO'){
          increment(states[index],target,'rule:'+rule.token+':target',signalLength(ruleSource));
        }
      }
    }
  }

  const runeTotals=new Map(runes.map(rune=>[rune.runeId,{
    rune_id:rune.runeId,
    label:rune.label||rune.name,
    group:rune.group,
    order:rune.order,
    count:0,
    document_count:0
  }]));
  const groupTotals=new Map([...groupOrder.entries()].map(([group,order])=>[group,{
    group,
    order,
    hit_count:0,
    document_count:0
  }]));

  let classifiedCount=0;
  let unclassifiedCount=0;
  let tieCount=0;
  const classifications=[];

  states.forEach((state,index)=>{
    for(const item of state.runeCounts.values()){
      const total=runeTotals.get(item.rune_id);
      if(!total)continue;
      total.count+=item.count;
      total.document_count+=1;
    }
    for(const item of state.groupCounts.values()){
      const total=groupTotals.get(item.label)||{group:item.label,order:item.order,hit_count:0,document_count:0};
      total.hit_count+=item.count;
      groupTotals.set(item.label,total);
    }

    const rankedRunes=[...state.runeCounts.values()].sort(compareRank);
    const rankedGroups=[...state.groupCounts.values()].sort(compareRank);
    const rankedClassGroups=[...state.classGroupCounts.values()].sort(compareRank);
    const topCount=Number(rankedClassGroups[0]?.count)||0;
    const countTiedGroups=topCount?rankedClassGroups.filter(item=>Number(item.count)===topCount):[];
    const topSignalChars=Math.max(0,...countTiedGroups.map(item=>Number(item.signal_chars)||0));
    const topGroups=countTiedGroups.filter(item=>(Number(item.signal_chars)||0)===topSignalChars);
    let status='unclassified';
    let classificationGroup='';

    if(!rankedClassGroups.length){
      unclassifiedCount+=1;
    }else{
      status='classified';
      classifiedCount+=1;
      if(topGroups.length>1&&fallbackGroup){
        classificationGroup=fallbackGroup;
        tieCount+=1;
      }else{
        classificationGroup=topGroups[0]?.label||rankedClassGroups[0].label;
      }
      const winner=groupTotals.get(classificationGroup);
      if(winner)winner.document_count+=1;
    }

    const row=source[index]||{};
    classifications.push({
      key:String(row.key||row.uid||index),
      uid:String(row.uid||''),
      kind:String(row.kind||''),
      title:String(row.title||'').trim(),
      date:String(row.date||row.createtime||row.created_at||'').slice(0,10),
      status,
      classification_group:classificationGroup,
      tied_groups:topGroups.length>1?topGroups.map(item=>item.label):[],
      top_class_signal_count:topCount,
      top_class_signal_chars:topSignalChars,
      hit_count:state.hitCount,
      top_rune:rankedRunes[0]?.label||'',
      top_rune_count:Number(rankedRunes[0]?.count)||0,
      rune_counts:rankedRunes,
      group_counts:rankedGroups,
      ...(termMatches?{matched_terms:[...termMatches[index]].sort()}:{}),
    });
  });

  return {
    documentCount:source.length,
    classifiedCount,
    unclassifiedCount,
    tieCount,
    classifications,
    runeTotals:[...runeTotals.values()].sort((a,b)=>a.rune_id-b.rune_id),
    runeRanking:[...runeTotals.values()].sort((a,b)=>b.count-a.count||b.document_count-a.document_count||a.rune_id-b.rune_id),
    groupTotals:[...groupTotals.values()].sort((a,b)=>a.order-b.order||a.group.localeCompare(b.group)),
    unsupportedRules
  };
}
