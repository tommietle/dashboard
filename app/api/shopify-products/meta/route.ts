import { NextRequest, NextResponse } from 'next/server';
import { fetchShopifyProductMeta } from '@/lib/shopifyProductMeta';

interface Body {
  store: 'luhvia' | 'cecole' | 'luvande' | 'modemeister' | 'all';
  luhvia?: string[];
  cecole?: string[];
  luvande?: string[];
  modemeister?: string[];
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const luhviaIds       = body.luhvia       ?? [];
  const cecoleIds       = body.cecole       ?? [];
  const luvandeIds      = body.luvande      ?? [];
  const modemeisterIds  = body.modemeister  ?? [];

  try {
    const [luhviaMap, cecoleMap, luvandeMap, modemeisterMap] = await Promise.all([
      luhviaIds.length      ? fetchShopifyProductMeta('luhvia',      luhviaIds)      : Promise.resolve(new Map()),
      cecoleIds.length      ? fetchShopifyProductMeta('cecole',      cecoleIds)      : Promise.resolve(new Map()),
      luvandeIds.length     ? fetchShopifyProductMeta('luvande',     luvandeIds)     : Promise.resolve(new Map()),
      modemeisterIds.length ? fetchShopifyProductMeta('modemeister', modemeisterIds) : Promise.resolve(new Map()),
    ]);

    return NextResponse.json({
      luhvia:      Object.fromEntries(luhviaMap),
      cecole:      Object.fromEntries(cecoleMap),
      luvande:     Object.fromEntries(luvandeMap),
      modemeister: Object.fromEntries(modemeisterMap),
    });
  } catch (err: any) {
    console.error('Shopify meta error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
