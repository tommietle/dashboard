import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const REDIS_KEY = 'dashboard:qc-checks';

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function readAll(): Promise<Record<string, boolean>> {
  const redis = getRedis();
  if (redis) {
    try { return (await redis.get<Record<string, boolean>>(REDIS_KEY)) ?? {}; }
    catch { return {}; }
  }
  return {};
}

async function writeAll(data: Record<string, boolean>): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try { await redis.set(REDIS_KEY, data); }
    catch { /* negeren */ }
  }
}

export async function GET() {
  return NextResponse.json(await readAll());
}

export async function POST(req: NextRequest) {
  const { store, productId, checked } = await req.json();
  if (!store || !productId || typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'store, productId en checked zijn verplicht' }, { status: 400 });
  }
  const all = await readAll();
  const key = `${store}:${productId}`;
  if (checked) all[key] = true;
  else delete all[key];
  await writeAll(all);
  return NextResponse.json({ ok: true });
}
