export type ThreatLevel = 'RED_FLAG' | 'WATCH';

export interface TriggerMatch {
  level: ThreatLevel;
  phrase: string;
  context: string;
}

// Explicit chargeback / dispute threats — act immediately
const RED_FLAG: string[] = [
  'chargeback', 'charge back', 'charge-back', 'chargebacks',
  'terugboeking', 'terugboeken',
  'paypal dispute', 'paypal claim', 'paypal case', 'paypal chargeback',
  'section 75',
  'credit card dispute', 'credit card company',
  'bank dispute', 'dispute with my bank',
  'i will dispute', "i'm disputing", 'disputing this charge',
  'filing a dispute', 'file a dispute', 'filed a dispute',
  'dispute this payment', 'dispute the charge',
  'unauthorized charge', 'fraudulent charge',
  'i did not authorize', 'not authorized this',
  'consumer protection agency', 'acm melding', 'afm',
  'ombudsman',
];

// Early warning signs — monitor closely
const WATCH: string[] = [
  'or else', 'of anders',
  'last warning', 'laatste waarschuwing', 'final warning',
  'never arrived', 'nooit aangekomen', 'nooit ontvangen',
  'never received', 'not received', 'niet ontvangen', 'niet aangekomen',
  'still not here', 'nog steeds niet',
  'where is my order', 'waar is mijn bestelling', 'waar is mijn pakket',
  'lawyer', 'advocaat', 'solicitor',
  'legal action', 'juridische stappen', 'rechtszaak',
  'trading standards', 'acm', 'consumentenbond',
  'consumer rights',
  'i want my money back', 'geld terug', 'mijn geld terug', 'refund or',
  'scam', 'oplichterij', 'oplichting', 'fraude', 'fraud',
  'report you', 'report this', 'aangifte doen',
  'review bombing', 'bad review', 'slechte review', 'trustpilot',
  'police', 'politie',
  'this is theft', 'stealing', 'diefstal',
  'social media', 'instagram', 'facebook post',
  'threatening', 'dreigen',
  'i will contact', 'ik neem contact op',
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function excerpt(text: string, idx: number, phraseLen: number): string {
  const start = Math.max(0, idx - 40);
  const end   = Math.min(text.length, idx + phraseLen + 40);
  const pre   = start > 0 ? '…' : '';
  const post  = end < text.length ? '…' : '';
  return pre + text.slice(start, end).trim() + post;
}

export function scanForTriggers(rawText: string): TriggerMatch | null {
  const text  = stripHtml(rawText);
  const lower = text.toLowerCase();

  for (const phrase of RED_FLAG) {
    const idx = lower.indexOf(phrase);
    if (idx >= 0) return { level: 'RED_FLAG', phrase, context: excerpt(text, idx, phrase.length) };
  }

  for (const phrase of WATCH) {
    const idx = lower.indexOf(phrase);
    if (idx >= 0) return { level: 'WATCH', phrase, context: excerpt(text, idx, phrase.length) };
  }

  return null;
}
