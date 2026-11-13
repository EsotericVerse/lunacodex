// Contract check for LOC access through the existing Manage ZModel + Zod.
// No database connection, synthetic persistent records, test grants or timers.
import assert from 'node:assert/strict';
import {loc_access,hasLocAccess,LOC_OWNER_EMAIL}
  from '../app/loc/permissions/loc_access.mjs';
import {bindLocAuthorization,canLocAccess}
  from '../app/loc/providers/loc-authorization.mjs';
import {setAuthorization,clearAuthorization,canAuthorizeLocAccess,createScopeAuthorizer}
  from '../app/loc/authorization-runtime.mjs';

const owner=LOC_OWNER_EMAIL;
const admin={id:'admin',email:owner,manage_role:'admin',active:false};
const group={id:'loc',email:owner,manage_role:'group',active:true};
const scope={id:'lo3rwang',email:owner,manage_role:'scope',active:true};
const inactive={id:'lrunes',email:owner,manage_role:'scope',active:false};

const website=loc_access(owner,[admin,group,scope,inactive],{website:true});
assert.equal(website.canManage,true,'virtual owner Admin retains global rights');
assert.equal(website.grants.includes('global:manage'),true);
assert.equal(website.grants.includes('loc:manage'),true);
assert.equal(website.grants.includes('group:loc:manage'),true);
assert.equal(website.grants.includes('scope:lo3rwang:manage'),true);
assert.equal(website.grants.includes('lo3rwang:manage'),true);
assert.equal(website.grants.includes('lrunes:manage'),false);
assert.equal(website.roles.length,3);

const mcp=loc_access(owner,[admin,group,scope,inactive]);
assert.equal(mcp.canManage,false,'MCP cannot use inactive virtual Admin');
assert.equal(mcp.grants.includes('global:manage'),false);
assert.equal(mcp.grants.includes('loc:manage'),true);
assert.equal(mcp.grants.includes('group:loc:manage'),true);
assert.equal(mcp.roles.length,2);

assert.equal(loc_access('visitor@example.com',[admin],{website:true}).canWrite,false);
// Other invited identities keep their own active Scope/Group access.
const invited='invited@example.com';
const invitedRole=loc_access(invited,[{id:'lrunes',email:invited,manage_role:'scope',active:true}],{website:true});
assert.equal(invitedRole.canWrite,true);
assert.equal(invitedRole.canManage,false);
assert.equal(invitedRole.grants.includes('scope:lrunes:manage'),true);
assert.equal(loc_access(invited,[{...admin,email:invited}],{website:true}).canManage,false);
assert.equal(loc_access(owner,[{...admin,active:null}],{website:true}).canManage,false);
assert.equal(loc_access(owner,[{...admin,active:undefined}],{website:true}).canManage,false);
assert.equal(loc_access(owner,[{...admin,id:'admin_invalid'}],{website:true}).canManage,false);
assert.equal(loc_access(owner,[{...admin,email:'somebody@example.com'}],{website:true}).canManage,false);
assert.equal(loc_access(owner,[{...admin,manage_role:'group'}],{website:true}).canManage,false);
assert.equal(loc_access(owner,[{...group,active:false}],{website:true}).canWrite,false);

const claims=(grants,options={})=>({
  provider:'loc',sub:'verified_123',me:true,grants,...options
});
assert.equal(hasLocAccess(claims(['global:manage']),'global'),true);
assert.equal(hasLocAccess(claims(['loc:manage']),'global'),false);
assert.equal(hasLocAccess(claims(['group:loc:manage','loc:manage']),'group','loc'),true);
assert.equal(hasLocAccess(claims(['scope:loc:manage','loc:manage']),'group','loc'),false);
assert.equal(hasLocAccess(claims(['group:loc:manage']),'scope','lo3rwang'),false);
assert.equal(hasLocAccess(claims(['loc:manage']),'scope','lo3rwang'),false);
assert.equal(hasLocAccess(claims(['scope:lo3rwang:manage','lo3rwang:manage']),'scope','lo3rwang'),true);
assert.equal(hasLocAccess(claims(['loc:manage'],{provider:'other'}),'group','loc'),false);
assert.equal(hasLocAccess(claims(['global:manage'],{me:false}),'global'),false);
assert.equal(hasLocAccess(claims(['global:manage']),'group','invalid scope'),false);

// Ensure trusted LOC Auth binding accepts a normal verified email; a malformed
// regex could otherwise silently remove every editor's role after refactor.
const fakeDb={selectFrom(){throw Error('Permission test must not query SQL')}};
bindLocAuthorization(fakeDb,{role:'authenticated',claims:{
  provider:'loc',sub:'verified_123',email:owner,me:true,grants:['loc:manage','group:loc:manage']
}});
assert.equal(canLocAccess(fakeDb,'group','loc'),true);
assert.equal(canLocAccess(fakeDb,'global'),false);

// Browser checks reuse a single verified role snapshot without SQL or Auth calls.
const browserUser={id:'local_test_user',email:owner};
setAuthorization(browserUser,[
  {id:'loc',email:owner,role:'group'},
  {id:'lo3rwang',email:owner,role:'scope'}
]);
assert.equal(canAuthorizeLocAccess('global'),false);
assert.equal(canAuthorizeLocAccess('group','loc'),true);
assert.equal(canAuthorizeLocAccess('scope','loc'),true);
assert.equal(canAuthorizeLocAccess('group','lo3rwang'),false);
assert.equal(canAuthorizeLocAccess('scope','lo3rwang'),true);
assert.equal(canAuthorizeLocAccess('scope','lrunes'),false);
const browserAuthorizer=createScopeAuthorizer(browserUser);
assert.equal(typeof browserAuthorizer.canLocAccessSync,'function');
assert.equal(Object.keys(browserAuthorizer).some(key=>key.startsWith('canManage')),false);
clearAuthorization();
assert.equal(canAuthorizeLocAccess('scope','loc'),false);

console.log('loc_access ZModel roles, browser single predicate and MCP isolation: OK');
