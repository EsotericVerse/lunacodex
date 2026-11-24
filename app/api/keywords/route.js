import {handleKeywordRequest,keywordMethodNotAllowed} from '../../loc/keywords/api.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request){
  return handleKeywordRequest(request,process.env);
}
export function GET(){return keywordMethodNotAllowed();}
export function OPTIONS(){return keywordMethodNotAllowed();}
