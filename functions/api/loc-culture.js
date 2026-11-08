import {handleNativeCulture} from '../../app/loc/server/native-culture.mjs';
export function onRequestGet(context){
  return handleNativeCulture(context.request,context.env);
}
