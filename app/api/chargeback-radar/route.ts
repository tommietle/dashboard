import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { STORES, getShopifyAccessToken, isShopifyConfigured } from '@/lib/shopify';
import {
  REAMAZE_BRANDS,
  isReamazeConfigured,
  fetchOpenConversations,
  htmlToText,
  type ShopKey,
} from '@/lib/reamaze';
import {
  detectTriggers,
  isSystemSender,
  computeSeverity,
  type DetectedTrigger,
} from '@/lib/chargebackTriggers';

const STORE_KEYS: ShopKey[] = ['luhvia', 'cecole', 'luvande', 'modemeister'];

export interface RadarItem {
  store: ShopKey;
  storeName: string;
  flag: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  orderRef: string | null;
  orderValue: number | null;
  currency: string;
  ordersCount: number | null;
  daysOpen: number;
  lastMessageAt: string;
  snippet: string;
  triggers: DetectedTrigger[];
  tier: 'red' | 'watch';
  reamazeUrl: string | null;
  severity: number;
  answered: boolean;
  waitingDays: number | null;
}

const SCAN_PAGES = 5;

function extractOrderRef(text: string): string | null {
  const m =
    text.match(/#?\b(?:luhvia|cecole|luvande|modemeister)\s?#?\d{3,6}\b/i) ||
    text.match(/order[^a-z0-9]{0,3}#?(\d{3,6})\b/i) ||
    text.match(/#(\d{3,6})\b/);
  if (!m) return null;
  return m[0].replace(/order/i, '').replace(/[^a-z0-9#]/gi, '').replace(/^#?/, '#');
}

function rank(it: RadarItem): number {
  return (it.tier === 'red' ? 1000 : 0) + it.triggers.length;
}

async function enrich(store: ShopKey, it: RadarItem): Promise<void> {
  if (!isShopifyConfigured(store)) return;
  const cfg = STORES[store];
  let token: string;
  try {
    token = await getShopifyAccessToken(store);
  } catch {
    return;
  }

  try {
    const r = await fetch(
      `https://${cfg.store}/admin/api/2024-04/customers/search.json?query=email:${encodeURIComponent(it.customerEmail)}&fields=id,orders_count`,
      { headers: { 'X-Shopify-Access-Token': token }, next: { revalidate: 600 } },
    );
    if (r.ok) {
      const d = await r.json();
      const c = d.customers?.[0];
      if (c) it.ordersCount = c.orders_count ?? null;
    }
  } catch { /* best effort */ }

  if (it.orderRef) {
    try {
      const name = it.orderRef.replace(/^#/, '');
      const r = await fetch(
        `https://${cfg.store}/admin/api/2024-04/orders.json?name=${encodeURIComponent(name)}&status=any&limit=1&fields=name,current_total_price,total_price,currency`,
        { headers: { 'X-Shopify-Access-Token': token }, next: { revalidate: 600 } },
      );
      if (r.ok) {
        const d = await r.json();
        const o = d.orders?.[0];
        if (o) {
          it.orderValue = parseFloat(o.current_total_price || o.total_price || '0') || null;
          it.currency = o.currency || it.currency;
        }
      }
    } catch { /* best effort */ }
  }
}

async function buildStore(store: ShopKey): Promise<RadarItem[]> {
  const brand = REAMAZE_BRANDS[store];
  const convs = await fetchOpenConversations(brand, SCAN_PAGES);
  const now = Date.now();
  const items: RadarItem[] = [];

  for (const c of convs) {
    const lcm = c.last_customer_message;
    const author = lcm?.user || c.author;
    const email = author?.email || c.author?.email || '';

    if (author?.['staff?']) continue;
    if (isSystemSender(email)) continue;

    const body = htmlToText(lcm?.body || c.message?.body || '');
    const triggers = detectTriggers(`${c.subject} ${body}`);
    if (triggers.length === 0) continue;

    const threats = triggers.filter((t) => t.type === 'threat');
    const signals = triggers.filter((t) => t.type === 'signal');
    const isThreat = threats.length > 0;

    if (!isThreat) {
      const hasChina = signals.some((s) => s.key === 'china_return');
      if (signals.length < 2 && !hasChina) continue;
    }

    const daysOpen = Math.max(0, Math.round((now - new Date(c.created_at).getTime()) / 86_400_000));

    const lastCust  = lcm?.created_at ? new Date(lcm.created_at).getTime() : 0;
    const lastStaff = c.last_staff_message?.created_at
      ? new Date(c.last_staff_message.created_at).getTime()
      : 0;
    const answered    = lastStaff > 0 && lastStaff >= lastCust;
    const waitingDays = answered || !lastCust
      ? null
      : Math.max(0, Math.round((now - lastCust) / 86_400_000));

    items.push({
      store,
      storeName: STORES[store].name,
      flag: STORES[store].flag,
      customerEmail: email,
      customerName: author?.name || null,
      subject: c.subject,
      orderRef: extractOrderRef(`${c.subject} ${body}`),
      orderValue: null,
      currency: STORES[store].currency,
      ordersCount: null,
      daysOpen,
      lastMessageAt: lcm?.created_at || c.updated_at,
      snippet: body.slice(0, 200),
      triggers,
      tier: isThreat ? 'red' : 'watch',
      reamazeUrl: c.perma_url || null,
      severity: 0,
      answered,
      waitingDays,
    });
  }

  const byEmail = new Map<string, RadarItem>();
  for (const it of items) {
    const prev = byEmail.get(it.customerEmail);
    if (!prev || rank(it) > rank(prev)) byEmail.set(it.customerEmail, it);
  }
  const deduped = [...byEmail.values()];

  await Promise.all(deduped.map((it) => enrich(store, it)));
  for (const it of deduped) {
    it.severity = computeSeverity(it.triggers, (it.ordersCount ?? 0) > 1, it.ordersCount === 1);
  }
  return deduped;
}

export async function GET(req: NextRequest) {
  if (!isReamazeConfigured()) {
    return NextResponse.json({ configured: false, items: [] });
  }

  const store = (new URL(req.url).searchParams.get('store') || 'all') as ShopKey | 'all';
  const keys = STORE_KEYS.filter((k) => store === 'all' || k === store);

  try {
    const items = await cached(`radar:v3:${store}`, 300, async () => {
      const all = (
        await Promise.all(keys.map((k) => buildStore(k).catch(() => [] as RadarItem[])))
      ).flat();
      all.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === 'red' ? -1 : 1;
        if (a.answered !== b.answered) return a.answered ? 1 : -1;
        return b.severity - a.severity;
      });
      return all;
    });
    return NextResponse.json({ configured: true, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ configured: true, items: [], error: message }, { status: 500 });
  }
}
