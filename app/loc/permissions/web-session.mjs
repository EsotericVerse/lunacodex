import {WebPermissionSessionSchema,WebRoleSchema} from './web-schema.mjs';

// A sessionStorage-only UI permission snapshot. It never authenticates a
// request and must never be accepted as proof of a database write grant.
// Writes continue through the existing server-side permission checks.
const KEY='loc-web-permission-session-v1';
export const WEB_PERMISSION_IDLE_MS=30*60*1000;
export const WEB_PERMISSION_SESSION_MS=2*60*60*1000;
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
function identity(user){
  return {subject:String(user?.id||''),email:normalizeEmail(user?.email)};
}
export function clearWebPermissionSession(storage){
  try{storage?.removeItem(KEY);}catch{}
}
export function enableWebPermissionSession(storage,user,rows,now=Date.now()){
  const {subject,email}=identity(user);
  const parsed=WebRoleSchema.array().max(256).safeParse(
    (Array.isArray(rows)?rows:[]).map(row=>({
      id:row?.id,email:normalizeEmail(row?.email),role:row?.role
    }))
  );
  if(!subject||!parsed.success||!parsed.data.length||
     parsed.data.some(row=>row.email!==email))
    return false;
  const snapshot=WebPermissionSessionSchema.safeParse({
    subject,email,roles:parsed.data,createdAt:now,usedAt:now
  });
  if(!snapshot.success)return false;
  try{storage?.setItem(KEY,JSON.stringify(snapshot.data));return Boolean(storage)}
  catch{return false}
}
export function readWebPermissionSession(storage,user,now=Date.now()){
  const {subject,email}=identity(user);
  if(!subject||!email)return null;
  try{
    const raw=storage?.getItem(KEY);
    if(!raw)return null;
    const parsed=WebPermissionSessionSchema.safeParse(JSON.parse(raw));
    const value=parsed.success?parsed.data:null;
    if(!value||value.subject!==subject||value.email!==email||
       value.roles.length===0||value.roles.some(row=>row.email!==email)||
       now<value.usedAt||now<value.createdAt||
       now-value.usedAt>=WEB_PERMISSION_IDLE_MS||
       now-value.createdAt>=WEB_PERMISSION_SESSION_MS){
      clearWebPermissionSession(storage);
      return null;
    }
    storage?.setItem(KEY,JSON.stringify({...value,usedAt:now}));
    return value.roles.map(row=>({...row,manage_role:row.role}));
  }catch{
    clearWebPermissionSession(storage);
    return null;
  }
}
