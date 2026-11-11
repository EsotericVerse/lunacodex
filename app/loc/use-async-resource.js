'use client';

// LOC resource subscription facade for existing ZenStack/Kysely model readers.
// No TanStack/SWR provider, periodic refresh or retry worker.
export {useAsyncResource,useAsyncInfiniteResource,useResourceCache,useQueryClient} from '../../zenstack/client-queries';
