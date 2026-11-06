// Operator-only bootstrap for LOC delegations. An OAuth/AD/LDAP adapter may
// issue the same LOC contract after verifying its user; Edge never calls it.
// Keep LOC_DELEGATION_SECRET in trusted environment secrets, never in Git.
import {createHmac,randomUUID} from 'node:crypto';
import {issueDelegation} from '../app/loc/auth/delegation-contract.mjs';

const secret=process.env.LOC_DELEGATION_SECRET||'';
const email=String(process.env.LOC_DELEGATION_EMAIL||'').trim().toLowerCase();
const sub=String(process.env.LOC_DELEGATION_SUB||'').trim();
const grants=String(process.env.LOC_DELEGATION_GRANTS||'').split(',').filter(Boolean);
const hours=Number(process.env.LOC_DELEGATION_HOURS||1);
const audience=String(process.env.LOC_DELEGATION_AUDIENCE||'sql');
if(secret.length<32)throw Error('LOC_DELEGATION_SECRET requires at least 32 characters');
if(!Number.isInteger(hours)||hours<1||hours>24)
  throw Error('LOC_DELEGATION_HOURS must be 1–24');
const now=Math.floor(Date.now()/1000);
const payload=issueDelegation({
  sub,email,grants,sid:randomUUID(),audience,now,seconds:hours*3600
});
const base=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const body=base({typ:'JWT',alg:'HS256'})+'.'+base(payload);
process.stdout.write(body+'.'+createHmac('sha256',secret).update(body).digest('base64url')+'\n');
