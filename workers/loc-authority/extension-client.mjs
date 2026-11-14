import metadata from '../../public/extension/oauth/client.json' with {type:'json'};

const CLIENT_ID=metadata.client_id;
const scopes=Object.freeze(String(metadata.scope||'').split(/\s+/).filter(Boolean));

// This is the one first-party extension client. The JSON document is read by
// the Worker bundle and adapted to Better Auth's existing OAuth Provider
// client shape; no dynamic registration, remote metadata fetch, or extra
// client-discovery package is involved.
export function extensionClientDiscovery(){
  return {
    id:'loc-galaxy-link',
    matches:clientId=>clientId===CLIENT_ID,
    resolve:async(_ctx,clientId,existing)=>{
      if(clientId!==CLIENT_ID)return null;
      if(existing)return existing;
      return {
        clientId:CLIENT_ID,
        name:String(metadata.client_name||'LOC Galaxy'),
        uri:String(metadata.client_uri||''),
        icon:String(metadata.logo_uri||''),
        redirectUris:[...metadata.redirect_uris],
        grantTypes:[...metadata.grant_types],
        responseTypes:[...metadata.response_types],
        tokenEndpointAuthMethod:String(metadata.token_endpoint_auth_method||'none'),
        scopes,
        requirePKCE:true,
        applicationType:'native',
        disabled:false,
        skipConsent:false,
        enableEndSession:false,
        subjectType:'public'
      };
    },
    discoveryMetadata:{client_id_metadata_document_supported:false}
  };
}
