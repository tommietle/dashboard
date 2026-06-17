import { Redis } from '@upstash/redis';

// Centrale cache laag voor zware Shopify-aggregates (orders, returns, product revenue).
// Op Vercel: Upstash Redis (gedeeld tussen alle serverless invocaties).
// Lokaal zonder Redis: in-memory fallback (per Node-proces).
//
// Stale-while-revalidate:
//   - Binnen `ttlSeconds` na schrijven → "fresh", direct teruggeven.
//   - Tussen `ttlSeconds` en 3× `ttlSeconds` → "stale", direct teruggeven
//     én op de achtergrond opnieuw laden zodat de volgende request fresh is.
//   - Daarna → cache miss, loader wordt awaited.
//
// Gebruik:
//   const data = await cached('shopify:metrics:luhvia:2026-05-01:2026-05-31', 600, () => fetchStoreMetrics(...));

interface CacheEntry<T> {
  value: T;
  freshUntil: number; // epoch ms
}

const memCache = new Map<string, { entry: CacheEntry<unknown>; hardExpiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function readEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const hit = await redis.get<CacheEntry<T>>(key);
      return hit ?? null;
    } catch {
      return null;
    }
  }
  const slot = memCache.get(key);
  if (!slot) return null;
  if (slot.hardExpiresAt <= Date.now()) {
    memCache.delete(key);
    return null;
  }
  return slot.entry as CacheEntry<T>;
}

async function writeEntry<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const freshUntil = Date.now() + ttlSeconds * 1000;
  const entry: CacheEntry<T> = { value, freshUntil };
  const redis = getRedis();
  if (redis) {
    try {
      // Hard TTL = 3× fresh window. Tussenliggend = stale-but-servable.
      await redis.set(key, entry, { ex: ttlSeconds * 3 });
    } catch {
      // negeren — cache miss is geen reden om de request te laten falen
    }
    return;
  }
  memCache.set(key, { entry, hardExpiresAt: freshUntil + ttlSeconds * 2 * 1000 });
}

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const stored = await readEntry<T>(key);
  const now = Date.now();

  if (stored) {
    if (stored.freshUntil > now) {
      return stored.value;
    }
    // Stale: serveer direct, ververs op de achtergrond.
    if (!inFlight.has(key)) {
      const p = loader()
        .then(async value => {
          await writeEntry(key, value, ttlSeconds);
          return value;
        })
        .catch(err => {
          console.error(`Cache refresh failed for ${key}:`, err);
          return stored.value;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, p);
    }
    return stored.value;
  }

  // Volledige miss: dedup gelijktijdige loads voor dezelfde key.
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const p = loader()
    .then(async value => {
      await writeEntry(key, value, ttlSeconds);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p as Promise<T>;
}

// Lager-niveau primitives voor cases waar je per-key wil lezen/schrijven
// zonder direct een loader te draaien (bv. batched fetches in shopifyProductMeta).
// Deze gebruiken een platte representatie (geen SWR-wrapper).
export async function getCachedValue<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const hit = await redis.get<CacheEntry<T>>(key);
      return hit?.value ?? null;
    } catch {
      return null;
    }
  }
  const slot = memCache.get(key);
  if (slot && slot.hardExpiresAt > Date.now()) {
    return (slot.entry as CacheEntry<T>).value;
  }
  return null;
}

// Haalt meerdere keys in één MGET op — veel sneller dan N aparte GETs.
export async function getCachedMany<T>(keys: string[]): Promise<Map<string, T>> {
  if (keys.length === 0) return new Map();
  const result = new Map<string, T>();
  const redis = getRedis();
  if (redis) {
    try {
      const values = await redis.mget<(CacheEntry<T> | null)[]>(...keys);
      for (let i = 0; i < keys.length; i++) {
        const entry = values[i];
        if (entry?.value !== undefined) result.set(keys[i], entry.value);
      }
      return result;
    } catch {
      // fall through to mem cache
    }
  }
  const now = Date.now();
  for (const key of keys) {
    const slot = memCache.get(key);
    if (slot && slot.hardExpiresAt > now) result.set(key, (slot.entry as CacheEntry<T>).value);
  }
  return result;
}

export async function setCachedValue<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await writeEntry(key, value, ttlSeconds);
}

// Handmatige invalidate (bv. na archiveren van een product)
export async function invalidateCache(pattern: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      let cursor: string = '0';
      do {
        const [next, keys] = (await redis.scan(cursor, { match: pattern, count: 100 })) as [string, string[]];
        if (keys.length > 0) await redis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch {
      // negeren
    }
  }
  for (const key of memCache.keys()) {
    if (matchesPattern(key, pattern)) memCache.delete(key);
  }
}

function matchesPattern(key: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return regex.test(key);
}
