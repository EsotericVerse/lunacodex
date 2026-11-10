---
title: Reuse LOC ZenStack Client Queries for Deduplication
impact: MEDIUM-HIGH
impactDescription: share requests and updates in the existing client runtime
tags: client, zenstack, deduplication, data-fetching
---

## Reuse LOC ZenStack Client Queries

LOC frontend data reads use the existing `zenstack/client-queries.js` runtime
and its single `QueryClient`. Do not reinstall the retired browser-query
library, construct a second provider/cache, or add an unused model RPC.

**Incorrect (duplicated per-component fetch state):**

```tsx
function UserList() {
  const [users,setUsers]=useState([])
  useEffect(()=>{void readUsers().then(setUsers)},[])
}
```

**Correct (one shared request per query key):**

```tsx
import {useAsyncResource} from '@/zenstack/client-queries'

function UserList() {
  const {data:users,isPending}=useAsyncResource({
    queryKey:['users'],queryFn:readUsers
  })
  return isPending?null:<UserListView users={users||[]}/>
}
```

On successful writes use the existing QueryClient invalidation. Paginated
queries use `useAsyncInfiniteResource`. Do not add polling or an extra store.
