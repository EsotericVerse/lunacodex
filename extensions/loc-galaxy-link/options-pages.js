// LOC Galaxy Link: local views inside one extension options document.
// No new routes, permissions, OAuth requests or remote dependencies.
const CONSOLE_PAGES=Object.freeze({
  overview:'總覽',
  daily:'每日符文',
  providers:'MCP 連線',
  capture:'擷取設定',
  activity:'Queue 與紀錄'
});
const consoleNav=Array.from(document.querySelectorAll('.nav-link'));
function selectedConsolePage(){
  const id=window.location.hash.slice(1);
  return Object.hasOwn(CONSOLE_PAGES,id)?id:'overview';
}
function renderConsolePage(){
  const selected=selectedConsolePage();
  for(const id of Object.keys(CONSOLE_PAGES)){
    document.getElementById(id).hidden=id!==selected;
  }
  for(const link of consoleNav){
    const active=link.getAttribute('href')==='#'+selected;
    link.classList.toggle('nav-active',active);
    if(active)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  document.getElementById('currentPageName').textContent=CONSOLE_PAGES[selected];
  document.title='LOC 彩虹橋｜'+CONSOLE_PAGES[selected];
}
for(const link of consoleNav){
  link.addEventListener('click',event=>{
    event.preventDefault();
    const target=link.getAttribute('href');
    if(window.location.hash!==target)window.location.hash=target;
    renderConsolePage();
    window.scrollTo(0,0);
  });
}
window.addEventListener('hashchange',()=>{
  renderConsolePage();
  window.scrollTo(0,0);
});
renderConsolePage();
