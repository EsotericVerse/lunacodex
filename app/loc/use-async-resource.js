'use client';

// Existing LOC imports keep their public hook contract. The implementation is
// owned by the ZenStack client-query layer, with a single QueryClient.
export {useAsyncResource,useAsyncInfiniteResource,useResourceCache} from '../../zenstack/client-queries';
