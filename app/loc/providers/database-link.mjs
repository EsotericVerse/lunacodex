// LOC database link display model: engine + host. Credentials stay in
// trusted LOC Auth / application backend storage, never in browser state.
export const DATABASE_PROVIDER_CHOICES=Object.freeze([
  Object.freeze({value:'custom',label:'SQL 連線',
    engines:['postgres','mysql','mssql','sqlite']})
]);
export function databaseProviderChoices(engine='postgres'){
  return DATABASE_PROVIDER_CHOICES.filter(choice=>choice.engines.includes(engine));
}
export function normalizeDatabaseLocation(provider,link){
  if(provider!=='custom')throw new Error('Unsupported LOC database provider');
  const value=String(link||'').trim();
  if(!value)throw new Error('Link / Host is required');
  if(value.length>512||/\s/.test(value)||value.includes('://'))
    throw new Error('Invalid SQL host');
  const match=/^\[([0-9a-f:]+)\](?::(\d{1,5}))?$|^([a-z0-9_.-]+)(?::(\d{1,5}))?$/i.exec(value);
  if(!match)throw new Error('Host must be an IP or hostname with an optional port');
  const host=match[1]||match[3],port=Number(match[2]||match[4]||0);
  if(port>65535||((match[2]||match[4])&&port<1))
    throw new Error('Invalid port');
  return {provider:'custom',link:value,host,port};
}
