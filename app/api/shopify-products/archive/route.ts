import { NextRequest, NextResponse } from 'next/server';
import { setShopifyProductStatus } from '@/lib/shopifyProductMeta';

type StoreKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

interface ArchiveBody {
  store: StoreKey;
  productIds: string[];
  action: 'archive' | 'unarchive';
}

export async function POST(req: NextRequest) {
  let body: ArchiveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { store, productIds, action } = body;

  if (store !== 'luhvia' && store !== 'cecole' && store !== 'luvande') {
    return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
  }
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return NextResponse.json({ error: 'productIds is required' }, { status: 400 });
  }
  if (action !== 'archive' && action !== 'unarchive') {
    return NextResponse.json({ error: 'action must be archive or unarchive' }, { status: 400 });
  }

  const targetStatus: 'archived' | 'active' = action === 'archive' ? 'archived' : 'active';

  const results: { productId: string; ok: boolean; error?: string }[] = [];
  for (const id of productIds) {
    if (!/^\d+$/.test(id)) {
      results.push({ productId: id, ok: false, error: 'Not a Shopify numeric ID' });
      continue;
    }
    try {
      await setShopifyProductStatus(store, id, targetStatus);
      results.push({ productId: id, ok: true });
    } catch (err: any) {
      results.push({ productId: id, ok: false, error: err.message });
    }
  }

  const okCount = results.filter(r => r.ok).length;
  return NextResponse.json({
    updated: okCount,
    failed: results.length - okCount,
    results,
  });
}
