const endpoint=document.querySelector('#endpoint'),token=document.querySelector('#token'),status=document.querySelector('#status');
(async()=>{const v=await chrome.storage.local.get(['endpoint','token']);endpoint.value=v.endpoint||'https://loc-auth.sopa2306.workers.dev';token.value=v.token||'';})();
document.querySelector('#save').addEventListener('click',async()=>{
 try{const value=endpoint.value.trim().replace(/\/$/,'');const u=new URL(value);if(u.protocol!=='https:')throw Error('必須使用 HTTPS');if(!token.value.trim())throw Error('請提供寫入 Token');await chrome.storage.local.set({endpoint:value,token:token.value.trim()});status.textContent='設定已儲存';}
 catch(e){status.textContent=e.message;}
});
