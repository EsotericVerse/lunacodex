// Galaxy.site stores an actual From-platform label, never its MCP Domain.
// SiteAnchor hierarchy remains defined only by published Anchor UID edges.
export const CAPTURE_FROM_SITES=Object.freeze(['web','Github','ChatGPT','Claude','Gemini']);
export const CAPTURE_LOOKUP_SITES=Object.freeze([...CAPTURE_FROM_SITES,'mcp']);
const matches=(host,domain)=>host===domain||host.endsWith('.'+domain);
export function siteForCapturedUrl(value){
 let url;
 try{url=new URL(String(value||''));}catch{return 'web';}
 if(!['http:','https:'].includes(url.protocol))return 'web';
 const host=url.hostname.toLowerCase();
 if(matches(host,'chatgpt.com')||host==='chat.openai.com')return 'ChatGPT';
 if(matches(host,'claude.ai'))return 'Claude';
 if(matches(host,'gemini.google.com'))return 'Gemini';
 if(matches(host,'github.com'))return 'Github';
 return 'web';
}
