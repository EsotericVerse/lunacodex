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
