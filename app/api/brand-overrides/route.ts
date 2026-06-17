import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const REDIS_KEY = 'dashboard:brand-overrides';

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function readAll(): Promise<Record<string, string>> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.get<Record<string, string>>(REDIS_KEY)) ?? {};
    } catch { return {}; }
  }
  return {};
}

async function writeAll(data: Record<string, string>): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      // Geen TTL — brand overrides zijn permanent.
      await redis.set(REDIS_KEY, data);
    } catch { /* negeren */ }
  }
}

export async function GET() {
  return NextResponse.json(await readAll());
}

export async function POST(req: NextRequest) {
  const { store, productId, brandName } = await req.json();
  if (!store || !productId || typeof brandName !== 'string') {
    return NextResponse.json({ error: 'store, productId en brandName zijn verplicht' }, { status: 400 });
  }
  const all = await readAll();
  const key = `${store}:${productId}`;
  if (brandName.trim() === '') {
    delete all[key];
  } else {
    all[key] = brandName.trim();
  }
  await writeAll(all);
  return NextResponse.json({ ok: true });
}
