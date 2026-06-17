import { promises as fs } from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';

// Opslag voor Google Ads-koppelingen. Op Vercel: Upstash Redis (persistent).
// Lokaal zonder Redis-env: terugval op een JSON-bestand in /data (gitignored).
// Per store bewaren we de refresh token + wat metadata.

export interface AdsConnection {
  store: string;
  refreshToken: string;
  email?: string;
  accessibleCustomers?: string[];
  connectedAt: string;
}

type ConnectionsMap = Record<string, AdsConnection>;

const KEY_PREFIX = 'ads-conn:';
const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'google-ads-connections.json');

// Pakt zowel een Upstash-koppeling als de oudere Vercel KV-naamgeving op.
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function fsRead(): Promise<ConnectionsMap> {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    return JSON.parse(raw) as ConnectionsMap;
  } catch {
    return {};
  }
}

async function fsWrite(map: ConnectionsMap): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(map, null, 2), 'utf8');
}

export async function getConnection(store: string): Promise<AdsConnection | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.get<AdsConnection>(`${KEY_PREFIX}${store}`)) ?? null;
    } catch {
      // Redis unreachable — fall through to file storage
    }
  }
  const all = await fsRead();
  return all[store] ?? null;
}

export async function getAllConnections(): Promise<ConnectionsMap> {
  const redis = getRedis();
  if (redis) {
    try {
      const keys = await redis.keys(`${KEY_PREFIX}*`);
      if (!keys.length) return {};
      const values = await redis.mget<AdsConnection[]>(...keys);
      const map: ConnectionsMap = {};
      keys.forEach((k, i) => {
        const v = values[i];
        if (v) map[k.replace(KEY_PREFIX, '')] = v;
      });
      return map;
    } catch {
      // Redis unreachable — fall through to file storage
    }
  }
  return fsRead();
}

export async function saveConnection(conn: AdsConnection): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`${KEY_PREFIX}${conn.store}`, conn);
      return;
    } catch {
      // Redis unreachable — fall through to file storage
    }
  }
  const all = await fsRead();
  all[conn.store] = conn;
  await fsWrite(all);
}

export async function removeConnection(store: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(`${KEY_PREFIX}${store}`);
      return;
    } catch {
      // Redis unreachable — fall through to file storage
    }
  }
  const all = await fsRead();
  delete all[store];
  await fsWrite(all);
}
