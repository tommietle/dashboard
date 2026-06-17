import { NextResponse } from 'next/server';
import { fetchRecentConversations } from '@/lib/reamaze';
import { scanForTriggers, TriggerMatch } from '@/lib/chargebackTriggers';
import { cached } from '@/lib/cache';

export interface RadarItem {
  conversationId: string;
  number: number;
  subject: string;
  customerName: string;
  customerEmail: string;
  updatedAt: string;
  url: string;
  match: TriggerMatch;
}

export async function GET() {
  try {
    const items = await cached('reamaze:radar:v1', 300, async () => {
      const conversations = await fetchRecentConversations(14);
      const flagged: RadarItem[] = [];

      for (const conv of conversations) {
        let match = scanForTriggers(conv.subject);

        if (!match) {
          for (const msg of conv.messages) {
            match = scanForTriggers(msg.body);
            if (match) break;
          }
        }

        if (match) {
          flagged.push({
            conversationId: conv.id,
            number:         conv.number,
            subject:        conv.subject,
            customerName:   conv.customerName,
            customerEmail:  conv.customerEmail,
            updatedAt:      conv.updatedAt,
            url:            conv.url,
            match,
          });
        }
      }

      return flagged.sort((a, b) => {
        if (a.match.level !== b.match.level) return a.match.level === 'RED_FLAG' ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    });

    return NextResponse.json({ items });
  } catch (err: any) {
    console.error('Chargeback radar error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
