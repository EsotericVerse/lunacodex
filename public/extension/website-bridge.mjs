// Retired legacy website-to-extension credential relay.
// The native LOC 彩虹橋 Extension now starts OAuth PKCE itself at
// https://auth.lo3rwang.cc; never issue or forward a website Session here.
const status=document.getElementById('status');
if(status)status.textContent='請改由新版 LOC 彩虹橋 Chrome Extension 直接連接 LOC Auth。';
