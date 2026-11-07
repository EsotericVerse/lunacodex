// Display-only identity summary for LOC's native authorization boundary.
// Browser accounts authenticate through LOC Auth; SQL uses LOC delegation.
export function readonlyAuthStatus(){
  return Object.freeze({
    primaryOAuth:'LOC Auth（OAuth）',
    authorization:'LOC Authority',
    databaseAuthRequired:false
  });
}
