import { STORES, getShopifyAccessToken } from './shopify';
import { cached } from './cache';

export interface TopProduct {
  productId: string;
  title: string;
  variantTitle?: string;
  revenue: number;
  orders: number;
  quantity: number;
  aov: number;
  currency: string;
  store: 'luhvia' | 'cecole' | 'luvande' | 'modemeister';
  imageUrl?: string;
  brandName?: string;
}

export async function fetchTopProducts(
  storeKey: 'luhvia' | 'cecole' | 'luvande' | 'modemeister',
  startDate: string,
  endDate: string,
  limit = 20
): Promise<TopProduct[]> {
  return cached(
    `shopify:top-products:v5:${storeKey}:${startDate}:${endDate}:${limit}`,
    600,
    () => fetchTopProductsUncached(storeKey, startDate, endDate, limit),
  );
}

async function fetchTopProductsUncached(
  storeKey: 'luhvia' | 'cecole' | 'luvande' | 'modemeister',
  startDate: string,
  endDate: string,
  limit: number,
): Promise<TopProduct[]> {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);
  const allOrders: any[] = [];
  let pageInfo: string | null = null;
  let isFirst = true;

  while (true) {
    let endpoint: string;
    if (isFirst) {
      endpoint = `orders.json?status=any&financial_status=any&created_at_min=${startDate}T00:00:00&created_at_max=${endDate}T23:59:59&limit=250&fields=id,created_at,financial_status,line_items,refunds`;
      isFirst = false;
    } else if (pageInfo) {
      endpoint = `orders.json?page_info=${pageInfo}&limit=250&fields=id,created_at,financial_status,line_items,refunds`;
    } else {
      break;
    }

    const res = await fetch(`https://${cfg.store}/admin/api/2024-04/${endpoint}`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`Shopify products ${storeKey}: ${res.status}`);
    const data = await res.json();
    allOrders.push(...(data.orders || []));

    const nextMatch = res.headers.get('Link')?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
    if (!pageInfo) break;
  }

  // Aggregate by product_id
  const map = new Map<string, {
    title: string; revenue: number; orders: Set<string>; quantity: number; imageUrl?: string;
  }>();

  for (const order of allOrders) {
    const fs = order.financial_status;
    if (fs !== 'paid' && fs !== 'partially_refunded') continue;

    // Build refund map: line_item_id → total refunded amount
    const refundMap = new Map<number, number>();
    for (const refund of order.refunds || []) {
      for (const rli of refund.refund_line_items || []) {
        const lid = rli.line_item_id as number;
        const amt = parseFloat(rli.subtotal_set?.shop_money?.amount ?? rli.subtotal ?? '0');
        refundMap.set(lid, (refundMap.get(lid) ?? 0) + amt);
      }
    }

    for (const item of order.line_items || []) {
      const pid = String(item.product_id || item.title);
      const unitPrice = parseFloat(item.price_set?.shop_money?.amount ?? item.price ?? '0');
      const discount = parseFloat(item.total_discount_set?.shop_money?.amount ?? item.total_discount ?? '0');
      const gross = (unitPrice * (item.quantity || 1)) - discount;
      const refunded = refundMap.get(item.id as number) ?? 0;
      const price = gross - refunded;
      if (!map.has(pid)) {
        map.set(pid, { title: item.title, revenue: 0, orders: new Set(), quantity: 0, imageUrl: undefined });
      }
      const entry = map.get(pid)!;
      entry.revenue += price;
      entry.orders.add(order.id);
      entry.quantity += item.quantity || 1;
    }
  }

  return Array.from(map.entries())
    .map(([productId, d]) => ({
      productId,
      title: d.title,
      revenue: Math.round(d.revenue * 100) / 100,
      orders: d.orders.size,
      quantity: d.quantity,
      aov: d.orders.size > 0 ? Math.round((d.revenue / d.orders.size) * 100) / 100 : 0,
      currency: cfg.currency,
      store: storeKey,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export interface ProductRevenuePeriods {
  productId: string;
  d90: number;
  d30: number;
  d14: number;
  d7: number;
  custom?: number;
  store: 'luhvia' | 'cecole' | 'luvande' | 'modemeister';
  currency: string;
}

// Haalt per-product Shopify omzet op gesplitst in d7/d14/d30 windows
// (gemeten vanaf endDate). Gebruikt voor échte ROAS-berekening op de
// products page: Shopify omzet ÷ Google Ads spend.
export async function fetchProductRevenueByPeriod(
  storeKey: 'luhvia' | 'cecole' | 'luvande' | 'modemeister',
  endDate: string,
  customRange?: { start: string; end: string },
  include90 = false,
): Promise<ProductRevenuePeriods[]> {
  const cacheKey = customRange
    ? `shopify:product-revenue:v9:${storeKey}:${endDate}:${customRange.start}:${customRange.end}`
    : `shopify:product-revenue:v9:${storeKey}:${endDate}:${include90 ? '90' : '30'}`;
  return cached(
    cacheKey,
    600,
    () => fetchProductRevenueByPeriodUncached(storeKey, endDate, customRange, include90),
  );
}

async function fetchOrdersSequential(
  store: string,
  token: string,
  startStr: string,
  endStr: string,
): Promise<any[]> {
  const orders: any[] = [];
  let pageInfo: string | null = null;
  let isFirst = true;
  while (true) {
    let endpoint: string;
    if (isFirst) {
      endpoint = `orders.json?status=any&financial_status=any&created_at_min=${startStr}T00:00:00&created_at_max=${endStr}T23:59:59&limit=250&fields=id,created_at,financial_status,line_items,refunds`;
      isFirst = false;
    } else if (pageInfo) {
      endpoint = `orders.json?page_info=${pageInfo}&limit=250&fields=id,created_at,financial_status,line_items,refunds`;
    } else {
      break;
    }
    const res = await fetch(`https://${store}/admin/api/2024-04/${endpoint}`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    if (!res.ok) throw new Error(`Shopify orders ${store}: ${res.status}`);
    const data = await res.json();
    orders.push(...(data.orders || []));
    const nextMatch = res.headers.get('Link')?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
    if (!pageInfo) break;
  }
  return orders;
}

// Bij ranges > 90 dagen: opsplitsen in maandchunks en parallel fetchen
// zodat we niet sequentieel door 25+ pagina's hoeven.
function monthChunks(startStr: string, endStr: string): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let cur = new Date(startStr + 'T12:00:00Z');
  const last = new Date(endStr + 'T12:00:00Z');
  while (cur <= last) {
    const chunkStart = cur.toISOString().slice(0, 10);
    const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const chunkEnd = new Date(Math.min(nextMonth.getTime() - 1, last.getTime() + 43200000)).toISOString().slice(0, 10);
    chunks.push({ start: chunkStart, end: chunkEnd });
    cur = nextMonth;
  }
  return chunks;
}

async function fetchOrdersForRange(
  store: string,
  token: string,
  startStr: string,
  endStr: string,
): Promise<any[]> {
  const days = (new Date(endStr).getTime() - new Date(startStr).getTime()) / 86_400_000;
  if (days <= 95) {
    return fetchOrdersSequential(store, token, startStr, endStr);
  }
  // Lang bereik: parallel per maand
  const chunks = monthChunks(startStr, endStr);
  const results = await Promise.all(
    chunks.map(c => fetchOrdersSequential(store, token, c.start, c.end)),
  );
  return results.flat();
}

async function fetchProductRevenueByPeriodUncached(
  storeKey: 'luhvia' | 'cecole' | 'luvande' | 'modemeister',
  endDate: string,
  customRange?: { start: string; end: string },
  include90 = false,
): Promise<ProductRevenuePeriods[]> {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);

  const end = new Date(endDate + 'T23:59:59');
  const start90 = new Date(end);
  start90.setDate(start90.getDate() - 89);
  const cutoff30 = new Date(end);
  cutoff30.setDate(cutoff30.getDate() - 29);
  const cutoff14 = new Date(end);
  cutoff14.setDate(cutoff14.getDate() - 13);
  const cutoff7  = new Date(end);
  cutoff7.setDate(cutoff7.getDate() - 6);

  // Fetch only 90 days when explicitly requested; otherwise stick to 30 for speed.
  let startStr = (include90 ? start90 : cutoff30).toISOString().slice(0, 10);
  let endStr   = end.toISOString().slice(0, 10);
  // Window verbreden voor custom range buiten d30.
  if (customRange) {
    if (customRange.start < startStr) startStr = customRange.start;
    if (customRange.end > endStr)     endStr   = customRange.end;
  }

  const allOrders = await fetchOrdersForRange(cfg.store, token, startStr, endStr);

  const map = new Map<string, { d90: number; d30: number; d14: number; d7: number; custom: number }>();

  const customStartDate = customRange ? new Date(customRange.start + 'T00:00:00') : null;
  const customEndDate   = customRange ? new Date(customRange.end   + 'T23:59:59') : null;

  for (const order of allOrders) {
    const fs = order.financial_status;
    if (fs !== 'paid' && fs !== 'partially_refunded') continue;

    const orderDate = new Date(order.created_at);
    const in90 = orderDate >= start90;
    const in30 = orderDate >= cutoff30;
    const in14 = orderDate >= cutoff14;
    const in7  = orderDate >= cutoff7;
    const inCustom = customStartDate && customEndDate
      ? orderDate >= customStartDate && orderDate <= customEndDate
      : false;

    // Build refund map: line_item_id → total refunded amount (net)
    const refundMap = new Map<number, number>();
    for (const refund of order.refunds || []) {
      for (const rli of refund.refund_line_items || []) {
        const lid = rli.line_item_id as number;
        const amt = parseFloat(rli.subtotal_set?.shop_money?.amount ?? rli.subtotal ?? '0');
        refundMap.set(lid, (refundMap.get(lid) ?? 0) + amt);
      }
    }

    for (const item of order.line_items || []) {
      const pid = String(item.product_id || '');
      if (!pid) continue;
      const unitPrice = parseFloat(item.price_set?.shop_money?.amount ?? item.price ?? '0');
      const discount = parseFloat(item.total_discount_set?.shop_money?.amount ?? item.total_discount ?? '0');
      const gross = (unitPrice * (item.quantity || 1)) - discount;
      const refunded = refundMap.get(item.id as number) ?? 0;
      const price = gross - refunded;
      if (!map.has(pid)) map.set(pid, { d90: 0, d30: 0, d14: 0, d7: 0, custom: 0 });
      const e = map.get(pid)!;
      if (in90) e.d90 += price;
      if (in30) e.d30 += price;
      if (in14) e.d14 += price;
      if (in7)  e.d7  += price;
      if (inCustom) e.custom += price;
    }
  }

  const r = (v: number) => Math.round(v * 100) / 100;
  return Array.from(map.entries()).map(([productId, d]) => {
    const out: ProductRevenuePeriods = {
      productId,
      d90: include90 ? r(d.d90) : 0,
      d30: r(d.d30),
      d14: r(d.d14),
      d7:  r(d.d7),
      store: storeKey,
      currency: cfg.currency,
    };
    if (customRange) out.custom = r(d.custom);
    return out;
  });
}
