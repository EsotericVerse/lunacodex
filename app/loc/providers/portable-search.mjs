// Literal substring matching shared by LOC's SQL gateway and search UI.
// The custom ESCAPE marker avoids PostgreSQL/MySQL backslash-mode differences.
// With no content index, this is a correctness/portability optimisation, not
// a claim that unrestricted substring matches have indexed performance.
export function portableContainsSpec(raw){
  const term=String(raw??'').trim();
  const fold=term.toLowerCase()!==term.toUpperCase();
  const normalized=fold?term.toLowerCase():term;
  return {
    fold,
    pattern:'%'+normalized.replace(/[!%_]/g,char=>'!'+char)+'%'
  };
}

// Existing OR transport uses quoted PostgREST-like predicates; a contains
// operand is a literal string, never SQL or a wildcard expression.
export function portableContainsTerm(raw){
  return String(raw??'').trim().replace(/\\/g,'\\\\').replace(/"/g,'\\"')
    .replace(/[\r\n\t]/g,' ');
}


// Shared PostgREST-style boolean-group parser for the browser-independent
// SQL Gateway and the device-local SQLite query builder. No SQL text/values
// are interpolated by this parser: each consumer compiles named predicates
// with a bound value and checks the identifier grammar.
const OR_TERM=/^([a-z][a-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|contains|is)\.(?:"((?:\\.|[^"])*)"|([^,]*))$/i;
const OR_IDENTIFIER=/^[a-z][a-z0-9_]*$/i;
function splitOrGroup(expression){
  const parts=[];let start=0,quoted=false,escaped=false,depth=0;
  for(let i=0;i<expression.length;i++){
    const ch=expression[i];
    if(escaped){escaped=false;continue;}
    if(ch==='\\'&&quoted){escaped=true;continue;}
    if(ch==='"')quoted=!quoted;
    else if(!quoted&&ch==='(')depth++;
    else if(!quoted&&ch===')'&&--depth<0)throw new Error('Malformed OR filter');
    else if(!quoted&&depth===0&&ch===','){parts.push(expression.slice(start,i));start=i+1;}
  }
  if(quoted||escaped||depth!==0)throw new Error('Malformed OR filter');
  parts.push(expression.slice(start));
  if(parts.length>30||parts.some(part=>!part.trim()))throw new Error('Invalid OR filter size');
  return parts;
}
function parseOrTerm(raw,depth=0){
  if(depth>8)throw new Error('OR filter nesting is too deep');
  const part=raw.trim();
  const group=part.match(/^(and|or)\(([\s\S]*)\)$/i);
  if(group)return {type:group[1].toLowerCase(),items:splitOrGroup(group[2]).map(item=>parseOrTerm(item,depth+1))};
  const match=part.match(OR_TERM);
  if(!match||!OR_IDENTIFIER.test(match[1]))throw new Error('Unsupported OR filter');
  const operator=match[2].toLowerCase();
  const rawValue=match[3]!==undefined?match[3].replace(/\\(["\\])/g,'$1'):match[4];
  // Search literals such as 'null', 'true', or '0001' must remain strings.
  const value=operator==='contains'?String(rawValue):
    rawValue==='true'?true:rawValue==='false'?false:rawValue==='null'?null:
    /^-?\d+(?:\.\d+)?$/.test(rawValue)?Number(rawValue):rawValue;
  return {type:'predicate',column:match[1],operator,value};
}
export function parsePortableOrExpression(expression){
  if(typeof expression!=='string')throw new Error('Invalid OR filter');
  return {type:'or',items:splitOrGroup(expression).map(part=>parseOrTerm(part))};
}
