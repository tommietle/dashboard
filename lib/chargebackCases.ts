// Chargeback Cases — a retrospective view for CS.
//
// Lists the disputes that actually became chargebacks (Cecole + Luhvia, in
// USD/CAD/GBP — the real customer markets, excluding the EUR fraud noise),
// links each to the customer's Re:amaze history, and diagnoses *why it likely
// went wrong* based on the patterns found in the chargeback study.

import { cached } from './cache';
import { STORES, getShopifyAccessToken, isShopifyConfigured } from './shopify';
import { REAMAZE_BRANDS, fetchCustomerConversations, htmlToText } from './reamaze';
import { detectTriggers } from './chargebackTriggers';
import { formatReason } from './shopifyDisputes';

export type CaseStore = 'cecole' | 'luhvia';
export const CASE_STORES: CaseStore[] = ['cecole', 'luhvia'];
export const CASE_CURRENCIES = ['USD', 'CAD', 'GBP'];

const STATUS_LABEL: Record<string, string> = {
  needs_response: 'Action required',
  under_review: 'Under review',
  won: 'Won',
  prevented: 'Prevented',
  lost: 'Lost',
  accepted: 'Accepted',
  charge_refunded: 'Refunded',
  open: 'Open',
};

export interface ChargebackCase {
  id: string;
  store: CaseStore;
  storeName: string;
  flag: string;
  orderName: string | null;
  customerEmail: string | null;
  customerName: string | null;
  amount: number;
  currency: string;
  reason: string;
  reasonLabel: string;
  status: string;
  statusLabel: string;
  outcome: 'lost' | 'won' | 'open';
  disposition: 'came_in' | 'prevented' | 'refunded';
  initiatedAt: string;
  daysOrderToCb: number | null;
  products: string[];
  // diagnosis
  contactedBefore: boolean;
  threatenedChargeback: boolean;
  grievance: string;
  rootCause: string;
  keyQuote: string | null;
  reamazeUrl: string | null;
  threads: { subject: string; date: string }[];
}

interface RawDispute {
  id: string | number;
  order_id?: string | number | null;
  type?: string;
  reason?: string;
  amount?: string;
  currency?: string;
  status?: string;
  initiated_at?: string;
}

async function shopify(store: CaseStore, path: string): Promise<unknown> {
  const cfg = STORES[store];
  const token = await getShopifyAccessToken(store);
  const res = await fetch(`https://${cfg.store}/admin/api/2024-04/${path}`, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    next: { revalidate: 600 },
  });
  if (!res.ok) throw new Error(`Shopify ${store} ${path}: ${res.status}`);
  return res.json();
}

function outcomeOf(status: string): 'lost' | 'won' | 'open' {
  if (status === 'lost' || status === 'charge_refunded') return 'lost';
  if (status === 'won' || status === 'prevented') return 'won';
  return 'open';
}

// Did the chargeback actually come in, or was it stopped before becoming one?
//   prevented      — caught by an alert / prevention tool (e.g. Disputifier) → did not become a chargeback
//   refunded       — the charge was refunded before it finalised (often an auto-refund by Disputifier)
//   came_in        — proceeded as a real chargeback (counts toward the chargeback rate)
function dispositionOf(status: string): 'came_in' | 'prevented' | 'refunded' {
  if (status === 'prevented') return 'prevented';
  if (status === 'charge_refunded') return 'refunded';
  return 'came_in';
}

function classify(text: string): { grievance: string; rootCause: string } {
  const s = text.toLowerCase();
  const has = (re: RegExp) => re.test(s);

  if (!s.trim()) {
    return {
      grievance: 'No prior contact',
      rootCause:
        'No support conversation found before the chargeback — possibly true or "friendly" fraud. Verify order, delivery proof and that 3-D Secure/AVS passed.',
    };
  }
  if (has(/return/)) {
    return {
      grievance: 'Return request',
      rootCause:
        'Customer asked to return the item. The return most likely felt too hard (e.g. ship-back-to-China at own cost vs. the advertised free/30-day returns) → they used a chargeback as leverage. Fix: honour an easy return fast.',
    };
  }
  if (has(/where is my order|not received|never arrived|didn'?t receive|haven'?t received|still waiting|tracking|delivery|estimated/)) {
    return {
      grievance: 'Delivery / not received',
      rootCause:
        'Customer reported the order late or not received. Tracking or delivery probably was not confirmed in time. Fix: proactive tracking updates + delivery proof.',
    };
  }
  if (has(/not as described|looks nothing|different|quality|cheap|wrong|size|material|misleading|scam/)) {
    return {
      grievance: 'Not as described',
      rootCause:
        'Customer said the item did not match the photos / wrong size / poor quality — a product-expectation gap on the PDP. Fix: honest photos + size guide + faster resolution.',
    };
  }
  return {
    grievance: 'Other complaint',
    rootCause:
      'Customer reached out before disputing, but the issue was most likely not resolved fast enough — it escalated into a chargeback.',
  };
}

async function buildStoreCases(store: CaseStore): Promise<ChargebackCase[]> {
  if (!isShopifyConfigured(store)) return [];
  const cfg = STORES[store];
  const brand = REAMAZE_BRANDS[store];

  const data = (await shopify(store, 'shopify_payments/disputes.json?limit=250')) as {
    disputes?: RawDispute[];
  };
  const raw = (data.disputes || []).filter(
    (d) =>
      (d.type ?? 'chargeback') === 'chargeback' &&
      CASE_CURRENCIES.includes((d.currency || '').toUpperCase()),
  );

  const cases = await Promise.all(
    raw.map(async (d): Promise<ChargebackCase> => {
      const base: ChargebackCase = {
        id: String(d.id),
        store,
        storeName: cfg.name,
        flag: cfg.flag,
        orderName: null,
        customerEmail: null,
        customerName: null,
        amount: parseFloat(d.amount || '0'),
        currency: (d.currency || cfg.currency).toUpperCase(),
        reason: d.reason || 'general',
        reasonLabel: formatReason(d.reason || 'general'),
        status: d.status || 'open',
        statusLabel: STATUS_LABEL[d.status || 'open'] || d.status || 'Open',
        outcome: outcomeOf(d.status || 'open'),
        disposition: dispositionOf(d.status || 'open'),
        initiatedAt: d.initiated_at || '',
        daysOrderToCb: null,
        products: [],
        contactedBefore: false,
        threatenedChargeback: false,
        grievance: 'No prior contact',
        rootCause: '',
        keyQuote: null,
        reamazeUrl: null,
        threads: [],
      };

      // Order → email, products, order date
      let email = '';
      if (d.order_id) {
        try {
          const od = (await shopify(
            store,
            `orders/${d.order_id}.json?fields=name,email,created_at,line_items,customer`,
          )) as { order?: any };
          const o = od.order;
          if (o) {
            base.orderName = o.name || null;
            email = o.email || '';
            base.customerEmail = email || null;
            base.customerName = o.customer
              ? `${o.customer.first_name ?? ''} ${o.customer.last_name ?? ''}`.trim() || null
              : null;
            base.products = (o.line_items || []).map((li: any) => li.title).slice(0, 4);
            if (o.created_at && base.initiatedAt) {
              const diff =
                (new Date(base.initiatedAt).getTime() - new Date(o.created_at).getTime()) /
                86_400_000;
              base.daysOrderToCb = Math.max(0, Math.round(diff));
            }
          }
        } catch {
          /* best effort */
        }
      }

      // Re:amaze history before the chargeback
      let combined = '';
      if (email) {
        try {
          const convs = await fetchCustomerConversations(brand, email);
          const cb = base.initiatedAt ? new Date(base.initiatedAt).getTime() : Infinity;
          const before = convs.filter((c) => new Date(c.created_at).getTime() < cb);
          if (before.length) {
            base.contactedBefore = true;
            base.threads = before
              .map((c) => ({ subject: c.subject, date: (c.created_at || '').slice(0, 10) }))
              .slice(0, 5);
            base.reamazeUrl = before[0].perma_url || null;
            const bodies = before.map((c) => htmlToText(c.last_customer_message?.body || ''));
            combined = `${before.map((c) => c.subject).join(' ')} ${bodies.join(' ')}`;
            base.keyQuote = bodies.find((b) => b.length > 20)?.slice(0, 220) || null;
          }
        } catch {
          /* best effort */
        }
      }

      // Diagnosis
      base.threatenedChargeback = detectTriggers(combined).some((t) => t.key === 'chargeback');
      if (base.reason === 'fraudulent' || base.reason === 'unrecognized') {
        base.grievance = 'Bank fraud claim';
        base.rootCause =
          'Coded as fraud / unrecognised by the bank. Very hard to win once filed — prevention (3-D Secure, AVS, fraud screening) is the only real lever.';
      } else if (!email) {
        base.grievance = 'No linked order';
        base.rootCause =
          'This dispute has no linked Shopify order, so it cannot be tied to a customer or their support history. These are often bank-side fraud claims — focus on prevention (3-D Secure / AVS).';
      } else if (!base.contactedBefore) {
        base.grievance = 'No prior contact';
        base.rootCause =
          'The order was found, but there is no support conversation before the chargeback — possibly "friendly" fraud. Verify delivery proof and that 3-D Secure/AVS passed.';
      } else {
        const { grievance, rootCause } = classify(combined);
        base.grievance = grievance;
        base.rootCause = rootCause;
      }
      if (base.threatenedChargeback) {
        base.rootCause +=
          ' ⚠ Customer explicitly threatened a chargeback in chat — it could have been intercepted before filing.';
      }

      return base;
    }),
  );

  return cases;
}

export async function fetchChargebackCases(): Promise<ChargebackCase[]> {
  return cached('cb-cases:v2', 1800, async () => {
    const all = (await Promise.all(CASE_STORES.map((s) => buildStoreCases(s).catch(() => [])))).flat();
    // Lost first (what we failed), then most recent.
    const order = { lost: 0, open: 1, won: 2 } as const;
    all.sort((a, b) => {
      if (order[a.outcome] !== order[b.outcome]) return order[a.outcome] - order[b.outcome];
      return new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime();
    });
    return all;
  });
}
