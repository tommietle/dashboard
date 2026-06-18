import { NextRequest, NextResponse } from 'next/server';
import {
  REAMAZE_BRANDS,
  isReamazeConfigured,
  fetchCustomerConversations,
  fetchConversationMessages,
  htmlToText,
  type ShopKey,
} from '@/lib/reamaze';
import { detectTriggers } from '@/lib/chargebackTriggers';

interface TranscriptMessage {
  role: 'customer' | 'staff';
  name: string;
  at: string;
  body: string;
}

interface Thread {
  subject: string;
  url: string | null;
  messages: TranscriptMessage[];
}

const HOUR = 3_600_000;

function buildCoaching(messages: TranscriptMessage[]): string[] {
  const tips: string[] = [];
  if (messages.length === 0) return tips;

  const firstCust = messages.find((m) => m.role === 'customer');
  const firstStaffAfter =
    firstCust && messages.find((m) => m.role === 'staff' && m.at > firstCust.at);

  // 1. First-response time
  if (firstCust && !messages.some((m) => m.role === 'staff')) {
    tips.push(
      'The customer never received a reply before disputing — the clearest miss. A same-day acknowledgement alone often prevents a chargeback.',
    );
  } else if (firstCust && firstStaffAfter) {
    const gapH = (new Date(firstStaffAfter.at).getTime() - new Date(firstCust.at).getTime()) / HOUR;
    if (gapH > 24) {
      const d = Math.round(gapH / 24);
      tips.push(
        `First reply took about ${d} day${d > 1 ? 's' : ''}. Aim for a first response within 24h — slow replies are the top driver of escalation.`,
      );
    }
  }

  const custText = messages.filter((m) => m.role === 'customer').map((m) => m.body).join(' ');
  const lower = custText.toLowerCase();
  const triggers = detectTriggers(custText);

  // 2. Threat that should have been intercepted
  const threat = messages.find(
    (m) => m.role === 'customer' && detectTriggers(m.body).some((t) => t.key === 'chargeback'),
  );
  if (threat) {
    tips.push(
      `The customer explicitly mentioned a chargeback/dispute on ${threat.at.slice(0, 10)}. That is the moment to resolve immediately (offer refund/return) — once filed it counts against your chargeback rate even if you win.`,
    );
  }

  // 3. Return friction
  if (triggers.some((t) => t.key === 'china_return') || /return.{0,20}china|ship.{0,20}china/.test(lower)) {
    tips.push(
      'The return-to-China cost pushed the customer to dispute. Offer a prepaid/local return, or a keep-it refund for low-value items — far cheaper than a lost chargeback.',
    );
  } else if (/\breturn\b/.test(lower)) {
    tips.push('Honour the return quickly and clearly; an unresolved return request is the most common pre-chargeback signal.');
  }

  // 4. Delivery / WISMO
  if (/where is my order|not received|never arrived|tracking|delivery|estimated|still waiting/.test(lower)) {
    tips.push('Share proactive tracking + an ETA early, and provide delivery proof — this prevents "item not received" disputes.');
  }

  // 5. Excessive back-and-forth
  const custCount = messages.filter((m) => m.role === 'customer').length;
  if (custCount >= 4) {
    tips.push(
      `${custCount} customer messages before resolution — a lot of back-and-forth signals friction. Empower CS to resolve (refund/return) in one reply.`,
    );
  }

  if (tips.length === 0) {
    tips.push('Conversation looks handled; the dispute may be friendly fraud. Keep the delivery proof and resolution offer on file as evidence.');
  }
  return tips;
}

export async function GET(req: NextRequest) {
  if (!isReamazeConfigured()) {
    return NextResponse.json({ threads: [], suggestions: [], reamaze: false });
  }
  const { searchParams } = new URL(req.url);
  const store = searchParams.get('store') as ShopKey | null;
  const email = searchParams.get('email');
  const before = searchParams.get('before'); // ISO date of the chargeback

  if (!store || !email || !REAMAZE_BRANDS[store]) {
    return NextResponse.json({ threads: [], suggestions: [], error: 'Missing store/email' }, { status: 400 });
  }

  try {
    const brand = REAMAZE_BRANDS[store];
    const cutoff = before ? new Date(before).getTime() : Infinity;
    const convs = (await fetchCustomerConversations(brand, email))
      .filter((c) => new Date(c.created_at).getTime() < cutoff)
      .slice(0, 6);

    const threads: Thread[] = [];
    const all: TranscriptMessage[] = [];

    for (const c of convs) {
      const msgs = await fetchConversationMessages(brand, c.slug);
      const transcript: TranscriptMessage[] = msgs
        .map((m) => ({
          role: (m.user?.['staff?'] ? 'staff' : 'customer') as 'customer' | 'staff',
          name: m.user?.name || m.user?.email || (m.user?.['staff?'] ? 'Support' : 'Customer'),
          at: m.created_at || '',
          body: htmlToText(m.body),
        }))
        .filter((m) => m.body)
        .sort((a, b) => a.at.localeCompare(b.at));
      if (transcript.length === 0) continue;
      threads.push({ subject: c.subject, url: c.perma_url || null, messages: transcript });
      all.push(...transcript);
    }

    all.sort((a, b) => a.at.localeCompare(b.at));
    return NextResponse.json({ threads, suggestions: buildCoaching(all), reamaze: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ threads: [], suggestions: [], error: message }, { status: 500 });
  }
}
