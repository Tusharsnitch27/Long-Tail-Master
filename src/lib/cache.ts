// Process-wide TTL cache with in-flight de-duplication and stale-while-revalidate.
// After the TTL, the last good value is served immediately while one background refresh runs, so an occasional
// slow warehouse query never blocks a page that has loaded before. Survives HMR via globalThis.
type Entry = { expires: number; value: Promise<unknown>; settled: boolean; refreshing: boolean };
const g = globalThis as unknown as { __ltCache?: Map<string, Entry> };
const store = (g.__ltCache ??= new Map());
const MAX_STALE_MS = 6 * 3600_000; // never serve anything older than this

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (hit && hit.settled && now - hit.expires < MAX_STALE_MS) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      fn().then(
        // only write back if nobody invalidated / replaced the entry meanwhile — otherwise a refresh that started
        // before a save would put the pre-save value back (e.g. targets appearing to revert)
        (v) => { if (store.get(key) === hit) store.set(key, { expires: Date.now() + ttlSeconds * 1000, value: Promise.resolve(v), settled: true, refreshing: false }); },
        () => { hit.refreshing = false; }, // keep serving the stale value; retry on next access
      );
    }
    return hit.value as Promise<T>;
  }
  const entry: Entry = { expires: now + ttlSeconds * 1000, value: fn(), settled: false, refreshing: false };
  store.set(key, entry);
  entry.value.then(() => { entry.settled = true; }, () => { if (store.get(key) === entry) store.delete(key); }); // never cache failures
  if (store.size > 800) {
    for (const [k, e] of store) if (e.expires + MAX_STALE_MS <= now) store.delete(k);
  }
  return entry.value as Promise<T>;
}

export function invalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
