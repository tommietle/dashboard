import { STORES, getShopifyAccessToken } from './shopify';
import { cached } from './cache';

// Uses GraphQL Admin API to get total refund amounts in store currency (shopMoney).
// This correctly converts USD transactions to CAD for Cecole, matching Shopify Analytics.
// Returns null if GraphQL is unavailable or fails (caller falls back to REST totals).
async function fetchGraphQLRefundTotal(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  startDate: string,
  endDate: string,
): Promise<number | null> {
  const cfg = STORES[storeKey];
  let total = 0;
  let cursor: string | null = null;
  let succeeded = false;

  try {
    const token = await getShopifyAccessToken(storeKey);
    while (true) {
      const afterArg: string = cursor ? `, after: "${cursor}"` : '';
      // updated_at >= startDate (no max) catches all orders that could have refunds in period.
      // We filter individual refunds by createdAt in code below.
      const gql: string = `{
        orders(first: 100, query: "(financial_status:refunded OR financial_status:partially_refunded) AND updated_at:>=${startDate}"${afterArg}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            refunds {
              createdAt
              transactions(first: 20) {
                edges { node { kind amountSet { shopMoney { amount } } } }
              }
            }
          }
        }
      }`;

      const res: Response = await fetch(
        `https://${cfg.store}/admin/api/2024-04/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: gql }),
          next: { revalidate: 300 },
        } as RequestInit,
      );

      if (!res.ok) return null;
      const data: any = await res.json();
      if (data.errors?.length) return null;
      succeeded = true;

      for (const order of data.data?.orders?.nodes ?? []) {
        for (const refund of order.refunds ?? []) {
          const refundDate = (refund.createdAt ?? '').slice(0, 10);
          if (refundDate < startDate || refundDate > endDate) continue;
          for (const edge of refund.transactions?.edges ?? []) {
            const txn = edge.node;
            if (txn.kind === 'REFUND') {
              total += parseFloat(txn.amountSet?.shopMoney?.amount ?? '0');
            }
          }
        }
      }

      const pageInfo: any = data.data?.orders?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }
    return succeeded ? total : null;
  } catch {
    return null;
  }
}

export interface ReturnProduct {
  productId: string;
  title: string;
  brandName: string;
  imageUrl: string;
  store: 'luhvia' | 'cecole' | 'luvande';
  currency: string;
  // Sales
  totalOrders: number;
  totalRevenue: number;
  // Returns
  returnedOrders: number;
  returnedQty: number;
  returnedRevenue: number;
  returnRate: number;       // %
  refundRevenuePct: number; // returnedRevenue / totalRevenue %
  // Disputes (filled in separately)
  disputeCount: number;
  disputeAmount: number;
}

export interface ReturnsMetrics {
  store: 'luhvia' | 'cecole' | 'luvande';
  currency: string;
  totalOrders: number;
  totalRefundedOrders: number;
  totalReturnedItems: number;
  totalReturnedRevenue: number;
  totalSoldRevenue: number;
  refundRevenuePct: number;
  products: ReturnProduct[];
}

async function paginateOrders(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  firstEndpoint: string,
  fields: string,
): Promise<any[]> {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);
  const all: any[] = [];
  let pageInfo: string | null = null;
  let isFirst = true;

  while (true) {
    const endpoint: string = isFirst
      ? firstEndpoint
      : `orders.json?page_info=${pageInfo}&limit=250&fields=${fields}`;
    isFirst = false;

    const res = await fetch(`https://${cfg.store}/admin/api/2024-04/${endpoint}`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`Shopify ${storeKey}: ${res.status}`);
    const data = await res.json();
    all.push(...(data.orders || []));

    const next = res.headers.get('Link')?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = next ? next[1] : null;
    if (!pageInfo) break;
  }
  return all;
}

// Product-meta verandert zelden — apart cachen met lange TTL (4u) zodat de
// returns-aggregaat het niet elke 10 min opnieuw hoeft te paginerren.
async function fetchProductMeta(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
): Promise<Map<string, { brandName: string; imageUrl: string }>> {
  const entries = await cached(
    `shopify:return-product-meta:${storeKey}`,
    4 * 3600,
    () => fetchProductMetaUncached(storeKey),
  );
  return new Map(entries);
}

async function fetchProductMetaUncached(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
): Promise<Array<[string, { brandName: string; imageUrl: string }]>> {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);
  const out: Array<[string, { brandName: string; imageUrl: string }]> = [];
  let pageInfo: string | null = null;
  let isFirst = true;

  while (true) {
    const endpoint: string = isFirst
      ? 'products.json?fields=id,tags,images&limit=250'
      : `products.json?page_info=${pageInfo}&limit=250&fields=id,tags,images`;
    isFirst = false;

    const res = await fetch(`https://${cfg.store}/admin/api/2024-04/${endpoint}`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
    });
    if (!res.ok) break;
    const data = await res.json();

    for (const product of data.products || []) {
      const tags: string[] = (product.tags || '')
        .split(',').map((t: string) => t.trim()).filter(Boolean);
      const GENDER_TAGS = new Set(['unisex', 'male', 'female', 'men', 'women', 'man', 'woman', 'boys', 'girls']);
      const isSystemTag = (t: string) => {
        const lower = t.toLowerCase();
        return GENDER_TAGS.has(lower) || lower.startsWith('feed-') || lower.includes(':');
      };
      const raw = tags.find(t => !isSystemTag(t)) || tags[0] || String(product.id);
      const brandName = raw.trim();
      const imageUrl: string = product.images?.[0]?.src || '';
      out.push([String(product.id), { brandName, imageUrl }]);
    }

    const next = res.headers.get('Link')?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = next ? next[1] : null;
    if (!pageInfo) break;
  }
  return out;
}

export async function fetchReturns(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  startDate: string,
  endDate: string,
): Promise<ReturnsMetrics> {
  return cached(
    `shopify:returns:${storeKey}:${startDate}:${endDate}`,
    600,
    () => fetchReturnsUncached(storeKey, startDate, endDate),
  );
}

async function fetchReturnsUncached(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  startDate: string,
  endDate: string,
): Promise<ReturnsMetrics> {
  const cfg = STORES[storeKey];
  const base = `created_at_min=${startDate}T00:00:00&created_at_max=${endDate}T23:59:59&limit=250`;
  const updatedBase = `updated_at_min=${startDate}T00:00:00&updated_at_max=${endDate}T23:59:59&limit=250`;

  // 6 separate financial_status paginations zijn vervangen door 2 brede queries:
  // - salesOrders: created_at in period — voor revenue + sold counts per product
  // - refundOrders: updated_at in period — voor refund-attributie en KPI's
  // We filteren financial_status in code naar {paid, refunded, partially_refunded}.
  const KEEP = new Set(['paid', 'refunded', 'partially_refunded']);

  const [salesAll, refundsAll, productMeta, gqlRefundTotal] = await Promise.all([
    paginateOrders(storeKey,
      `orders.json?status=any&${base}&fields=id,financial_status,line_items`,
      'id,financial_status,line_items'),
    paginateOrders(storeKey,
      `orders.json?status=any&${updatedBase}&fields=id,financial_status,refunds,line_items`,
      'id,financial_status,refunds,line_items'),
    fetchProductMeta(storeKey),
    fetchGraphQLRefundTotal(storeKey, startDate, endDate),
  ]);

  // All sold orders (for revenue + totalOrders)
  const allOrders: any[] = salesAll.filter(o => KEEP.has(o.financial_status));

  // Build totalMap (orders per product) and revenueMap from ALL sold orders
  const totalMap = new Map<string, { title: string; count: number }>();
  const revenueMap = new Map<string, number>();

  for (const order of allOrders) {
    const seenPerOrder = new Set<string>();
    for (const item of order.line_items || []) {
      const pid = String(item.product_id || item.title);
      if (!totalMap.has(pid)) totalMap.set(pid, { title: item.title, count: 0 });
      // Revenue: price × qty minus line-item discounts (matches Shopify net sales)
      const itemRevenue =
        parseFloat(item.price || '0') * (item.quantity || 1)
        - parseFloat(item.total_discount || '0');
      revenueMap.set(pid, (revenueMap.get(pid) || 0) + itemRevenue);
      if (!seenPerOrder.has(pid)) {
        seenPerOrder.add(pid);
        totalMap.get(pid)!.count++;
      }
    }
  }

  // Refund orders: by update date so refunds match Shopify Analytics (refund date, not order date)
  // Include paid orders — store-credit refunds don't change financial_status from "paid"
  const refundOrders: any[] = refundsAll.filter(o => KEEP.has(o.financial_status));

  // Only attribute returns to products when the order was placed in the same period.
  // This ensures returnedOrders <= totalOrders (same sales cohort).
  const salesOrderIds = new Set(allOrders.map(o => String(o.id)));

  const returnMap = new Map<string, {
    title: string; orderIds: Set<string>; qty: number; revenue: number;
  }>();

  for (const order of refundOrders) {
    if (!salesOrderIds.has(String(order.id))) continue;
    for (const refund of order.refunds || []) {
      // Only count refunds processed within the selected period
      const refundDate = (refund.created_at || '').slice(0, 10);
      if (refundDate < startDate || refundDate > endDate) continue;

      const rliItems: any[] = refund.refund_line_items || [];

      if (rliItems.length > 0) {
        // Explicit line items: use those directly
        for (const rli of rliItems) {
          const item = rli.line_item || {};
          const pid = String(item.product_id || item.title || 'unknown');
          const title = item.title || totalMap.get(pid)?.title || 'Onbekend product';
          if (!returnMap.has(pid)) {
            returnMap.set(pid, { title, orderIds: new Set(), qty: 0, revenue: 0 });
          }
          const e = returnMap.get(pid)!;
          e.orderIds.add(String(order.id));
          e.qty += rli.quantity || 0;
          e.revenue += parseFloat(rli.subtotal || '0');
        }
      } else {
        // Adjustment/custom refund — attribute to the product if the order has exactly one product
        const orderItems: any[] = order.line_items || [];
        const uniquePids = [...new Set(orderItems.map((i: any) => String(i.product_id || i.title)))];
        if (uniquePids.length === 1) {
          const pid = uniquePids[0];
          const title = orderItems[0]?.title || totalMap.get(pid)?.title || 'Onbekend product';
          if (!returnMap.has(pid)) {
            returnMap.set(pid, { title, orderIds: new Set(), qty: 0, revenue: 0 });
          }
          returnMap.get(pid)!.orderIds.add(String(order.id));
        }
      }
    }
  }

  // Include ALL sold products (not just those with returns) so store breakdowns are complete
  const allProductIds = new Set([...totalMap.keys(), ...returnMap.keys()]);

  const products: ReturnProduct[] = Array.from(allProductIds)
    .map(productId => {
      const sold = totalMap.get(productId);
      const ret  = returnMap.get(productId);
      const title = ret?.title || sold?.title || 'Onbekend product';
      const total = sold?.count ?? 0;
      const totalRev = revenueMap.get(productId) || 0;
      const retRevenue = ret?.revenue ?? 0;
      const meta = productMeta.get(productId);
      return {
        productId,
        title,
        brandName: meta?.brandName || title,
        imageUrl: meta?.imageUrl || '',
        store: storeKey,
        currency: cfg.currency,
        totalOrders: total,
        totalRevenue: Math.round(totalRev * 100) / 100,
        returnedOrders: ret?.orderIds.size ?? 0,
        returnedQty: ret?.qty ?? 0,
        returnedRevenue: Math.round(retRevenue * 100) / 100,
        returnRate: total > 0 ? Math.min(Math.round(((ret?.orderIds.size ?? 0) / total) * 1000) / 10, 100) : 0,
        refundRevenuePct: totalRev > 0 ? Math.round((retRevenue / totalRev) * 1000) / 10 : 0,
        disputeCount: 0,
        disputeAmount: 0,
      };
    })
    .sort((a, b) => b.returnedOrders - a.returnedOrders || b.returnRate - a.returnRate);

  // Use transaction amounts for the total KPI — rli.subtotal is 0 for custom/adjustment refunds
  // that don't specify line items (very common with Shopify manual refunds)
  let txnReturnedRevenue = 0;
  // Store-credit refunds have no payment transaction; track their RLI shop_money separately
  // so they can be added on top of the GraphQL transaction total.
  let noTxnRliTotal = 0;
  let refundedOrderCount = 0;
  for (const order of refundOrders) {
    let orderHadRefundInPeriod = false;
    for (const refund of order.refunds || []) {
      const refundDate = (refund.created_at || '').slice(0, 10);
      if (refundDate < startDate || refundDate > endDate) continue;
      orderHadRefundInPeriod = true;

      const txns: any[] = refund.transactions || [];
      const txnTotal = txns.reduce((s: number, t: any) =>
        s + parseFloat(t.amount_set?.shop_money?.amount ?? t.amount ?? '0'), 0);

      if (txnTotal > 0) {
        txnReturnedRevenue += txnTotal;
      } else {
        // No payment transaction (store-credit refund) — use RLI shop_money (store currency)
        const rliTotal: number = (refund.refund_line_items || [])
          .reduce((s: number, rli: any) =>
            s + parseFloat(rli.subtotal_set?.shop_money?.amount ?? rli.subtotal ?? '0'), 0);
        txnReturnedRevenue += rliTotal;
        noTxnRliTotal += rliTotal;
      }
    }
    if (orderHadRefundInPeriod) refundedOrderCount++;
  }

  const totalSoldRev = products.reduce((s, p) => s + p.totalRevenue, 0);
  // GraphQL covers transaction-based refunds (correct CAD via shopMoney).
  // noTxnRliTotal covers store-credit refunds not visible to GraphQL transactions.
  // Fall back to full REST calculation when GraphQL is unavailable.
  const finalReturnedRevenue = gqlRefundTotal !== null ? gqlRefundTotal + noTxnRliTotal : txnReturnedRevenue;

  return {
    store: storeKey,
    currency: cfg.currency,
    totalOrders: allOrders.length,
    totalRefundedOrders: refundedOrderCount,
    totalReturnedItems: products.reduce((s, p) => s + p.returnedQty, 0),
    totalReturnedRevenue: Math.round(finalReturnedRevenue * 100) / 100,
    totalSoldRevenue: Math.round(totalSoldRev * 100) / 100,
    refundRevenuePct: totalSoldRev > 0 ? Math.round((finalReturnedRevenue / totalSoldRev) * 1000) / 10 : 0,
    products,
  };
}
