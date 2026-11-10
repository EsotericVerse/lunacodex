---
title: Deduplicate Global Event Listeners
impact: LOW
impactDescription: a single listener for multiple components
tags: client, react, event-listeners, subscription
---

## Deduplicate Global Event Listeners

Keep one browser listener regardless of how many components subscribe.
The retired data-fetching library is not needed to manage DOM events.

```tsx
import {useEffect} from 'react'

const keyCallbacks = new Map<string, Set<() => void>>()
let subscriptions = 0

function onKeydown(event: KeyboardEvent) {
  if (!event.metaKey) return
  for (const callback of keyCallbacks.get(event.key) ?? []) callback()
}

function useKeyboardShortcut(key: string, callback: () => void) {
  useEffect(() => {
    const listeners = keyCallbacks.get(key) ?? new Set<() => void>()
    listeners.add(callback)
    keyCallbacks.set(key, listeners)
    if (subscriptions++ === 0) window.addEventListener('keydown', onKeydown)
    return () => {
      listeners.delete(callback)
      if (listeners.size === 0) keyCallbacks.delete(key)
      if (--subscriptions === 0) window.removeEventListener('keydown', onKeydown)
    }
  }, [key, callback])
}
```

Use stable callbacks where possible. Unsubscribe on unmount; never register
one global DOM listener per consumer or add a query library solely for events.
