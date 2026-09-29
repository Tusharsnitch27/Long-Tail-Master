// Process-wide TTL cache with in-flight de-duplication. Survives HMR via globalThis.
type Entry = { expires: number; value: Promise<unknown> };
const g = globalThis as unknown as { __ltCache?: Map<string, Entry> };
const store = (g.__ltCache ??= new Map());

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { expires: now + ttlSeconds * 1000, value });
  value.catch(() => store.delete(key)); // never cache failures
  if (store.size > 500) {
    for (const [k, e] of store) if (e.expires <= now) store.delete(k);
  }
  return value;
}

export function invalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
