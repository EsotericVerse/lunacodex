export function decodeLocCache(value){
  const c=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  return {
    cache_mode:['off','cache','isr'].includes(c.cache_mode)?c.cache_mode:'cache',
    cache_provider:String(c.cache_provider??''),
    isr_domains:Array.isArray(c.isr_domains)?c.isr_domains:[],
    io_limits:c.io_limits&&typeof c.io_limits==='object'&&!Array.isArray(c.io_limits)?c.io_limits:{}
  };
}
export function encodeLocCache(input){
  const c=decodeLocCache(input);
  if(String(input?.cache_mode??'cache')!==c.cache_mode)throw Error('無效的快取模式');
  if(!Array.isArray(input?.isr_domains))throw Error('ISR 網域設定必須為陣列');
  if(!input?.io_limits||typeof input.io_limits!=='object'||Array.isArray(input.io_limits))
    throw Error('I/O 限制設定格式錯誤');
  return c;
}
