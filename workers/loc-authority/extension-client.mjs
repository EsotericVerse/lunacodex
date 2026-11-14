import metadata from '../../public/extension/oauth/client.json' with {type:'json'};
import {RAINBOW_MODEL_NAMES} from './rainbow-zmodel.mjs';

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
    resolve:async(ctx,clientId,existing)=>{
      if(clientId!==CLIENT_ID)return null;
      if(existing)return existing;
      const client={
        id:crypto.randomUUID(),
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
        subjectType:'public',
        clientDiscoveryId:'loc-galaxy-link'
      };
      // The OAuth Provider can resolve a virtual first-party client, but
      // rainbow_oauth_consent.clientId has a real foreign key to oauthClient.
      // Register this exact bundled public client once through the existing
      // Better Auth/ZenStack adapter before the consent POST can write.
      // No arbitrary/dynamic registration or new storage is introduced.
      const adapter=ctx.context.adapter;
      const model=RAINBOW_MODEL_NAMES.oauthClient;
      try{
        return await adapter.create({model,data:client})||client;
      }catch(error){
        // Two concurrent authorize requests may attempt the same insert.
        // Only reuse the already registered exact client ID; never ignore
        // database errors or provision another client.
        const registered=await adapter.findOne({
          model,where:[{field:'clientId',value:CLIENT_ID}]
        });
        if(registered)return registered;
        throw error;
      }
    },
    discoveryMetadata:{client_id_metadata_document_supported:false}
  };
}
