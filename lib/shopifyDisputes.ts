import { STORES, getShopifyAccessToken } from './shopify';
import { cached } from './cache';

export interface Dispute {
  id: string;
  orderId: string | null;
  type: 'chargeback' | 'inquiry';
  amount: number;
  currency: string;
  reason: string;
  status: string;
  initiatedAt: string;
  evidenceDueBy: string | null;
  store: 'luhvia' | 'cecole' | 'luvande';
  products: { productId: string; title: string }[];
}

const REASON_LABELS: Record<string, string> = {
  bank_cannot_process: 'Bank cannot process',
  credit_not_processed: 'Credit not processed',
  customer_initiated: 'Customer initiated',
  debit_not_authorized: 'Debit not authorized',
  duplicate: 'Duplicate',
  fraudulent: 'Fraudulent',
  general: 'General',
  incorrect_account_details: 'Incorrect account details',
  insufficient_funds: 'Insufficient funds',
  product_not_received: 'Product not received',
  product_unacceptable: 'Product unacceptable',
  subscription_cancelled: 'Subscription cancelled',
  unrecognized: 'Unrecognized',
};

export function formatReason(r: string) {
  return REASON_LABELS[r] ?? r;
}

async function fetchOrderLineItems(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  orderId: string,
): Promise<{ productId: string; title: string }[]> {
  const cfg = STORES[storeKey];
  try {
    const token = await getShopifyAccessToken(storeKey);
    const res = await fetch(
      `https://${cfg.store}/admin/api/2024-04/orders/${orderId}.json?fields=id,line_items`,
      {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.order?.line_items || []).map((item: any) => ({
      productId: String(item.product_id || item.title),
      title: item.title || 'Onbekend product',
    }));
  } catch {
    return [];
  }
}

export async function fetchDisputes(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  startDate: string,
  endDate: string,
): Promise<Dispute[]> {
  return cached(
    `shopify:disputes:${storeKey}:${startDate}:${endDate}`,
    600,
    () => fetchDisputesUncached(storeKey, startDate, endDate),
  );
}

async function fetchDisputesUncached(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
  startDate: string,
  endDate: string,
): Promise<Dispute[]> {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);

  const res = await fetch(
    `https://${cfg.store}/admin/api/2024-04/shopify_payments/disputes.json?initiated_at_min=${startDate}T00:00:00&initiated_at_max=${endDate}T23:59:59`,
    {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
    },
  );

  if (!res.ok) {
    if (res.status === 403 || res.status === 404) return [];
    throw new Error(`Shopify disputes ${storeKey}: ${res.status}`);
  }

  const data = await res.json();
  const raw: any[] = data.disputes || [];

  // Fetch order line_items for all disputes that have an order_id (in parallel, max 20)
  const withOrderId = raw.filter(d => d.order_id).slice(0, 20);
  const lineItemResults = await Promise.all(
    withOrderId.map(d => fetchOrderLineItems(storeKey, String(d.order_id))),
  );
  const orderProductMap = new Map<string, { productId: string; title: string }[]>();
  withOrderId.forEach((d, i) => orderProductMap.set(String(d.order_id), lineItemResults[i]));

  return raw.map((d: any): Dispute => ({
    id: String(d.id),
    orderId: d.order_id ? String(d.order_id) : null,
    type: d.type === 'inquiry' ? 'inquiry' : 'chargeback',
    amount: parseFloat(d.amount || '0'),
    currency: d.currency || cfg.currency,
    reason: d.reason || 'general',
    status: d.status || 'unknown',
    initiatedAt: d.initiated_at || '',
    evidenceDueBy: d.evidence_due_by || null,
    store: storeKey,
    products: d.order_id ? (orderProductMap.get(String(d.order_id)) || []) : [],
  }));
}

// Build a map of productId → { disputeCount, disputeAmount } from a list of disputes
export function buildDisputeProductMap(disputes: Dispute[]): Map<string, { count: number; amount: number; currency: string }> {
  const map = new Map<string, { count: number; amount: number; currency: string }>();
  for (const dispute of disputes) {
    for (const p of dispute.products) {
      const existing = map.get(p.productId) || { count: 0, amount: 0, currency: dispute.currency };
      map.set(p.productId, {
        count: existing.count + 1,
        amount: existing.amount + dispute.amount,
        currency: dispute.currency,
      });
    }
  }
  return map;
}
