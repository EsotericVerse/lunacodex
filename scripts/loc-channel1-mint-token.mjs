// Private operator-only JWT tool; do not commit the signing secret.
import {createHmac} from 'node:crypto';
const secret=process.env.LOC_CHANNEL1_SECRET;
if(!secret||secret.length<32)throw Error('LOC_CHANNEL1_SECRET must be at least 32 characters');
const now=Math.floor(Date.now()/1000);
const base=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const content=base({typ:'JWT',alg:'HS256'})+'.'+base({iss:'loc-channel1',aud:'loc-kv-inbox',nbf:now-30,exp:now+365*24*3600,scopes:['record:create']});
console.log(content+'.'+createHmac('sha256',secret).update(content).digest('base64url'));
