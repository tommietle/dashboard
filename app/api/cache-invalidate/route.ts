import { NextResponse } from 'next/server';
import { invalidateCache } from '@/lib/cache';

export async function POST() {
  await invalidateCache('shopify:all-products:v2:*');
  await invalidateCache('shopify:product-meta:v6:*');
  return NextResponse.json({ ok: true });
}
