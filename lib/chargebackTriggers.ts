// Chargeback-risk trigger detection.
//
// Rule of thumb:
//   • any THREAT trigger present  → 🔴 RED FLAG (chargeback imminent, act now)
//   • only SIGNAL triggers        → 🟡 WATCH    (early risk, resolve before escalation)

export type TriggerType = 'threat' | 'signal';

export interface TriggerDef {
  key: string;
  label: string;
  icon: string;
  type: TriggerType;
  pattern: RegExp;
}

export const TRIGGERS: TriggerDef[] = [
  {
    key: 'chargeback',
    label: 'Chargeback threat',
    icon: '⚠️',
    type: 'threat',
    pattern: /charge\s?back|dispute (it|this|the charge|the payment|my)|my bank|card (issuer|company)|file a (claim|dispute)|item not as described/i,
  },
  {
    key: 'legal',
    label: 'Legal threat',
    icon: '⚖️',
    type: 'threat',
    pattern: /\blegal\b|lawyer|attorney|small claims|\bsue\b|\bauthorities\b|consumer protection/i,
  },
  {
    key: 'review',
    label: 'Review / BBB',
    icon: '🗣️',
    type: 'threat',
    pattern: /trustpilot|\bbbb\b|better business|(leave|post|write)[^.]{0,16}review|report you|expose you/i,
  },
  {
    key: 'ultimatum',
    label: 'Ultimatum',
    icon: '⏰',
    type: 'threat',
    pattern: /24 ?hours|48 ?hours|within \d+ ?(hours|days)|or i (will|'ll)|by (monday|tuesday|wednesday|thursday|friday|tomorrow|tonight|the end of)/i,
  },
  {
    key: 'scam',
    label: 'Scam accusation',
    icon: '🚫',
    type: 'threat',
    pattern: /\bscam|fraud|ripped? off|rip[\s-]?off|misleading|false advert|deceptive|bait and switch/i,
  },
  {
    key: 'full_refund',
    label: 'Full refund demand',
    icon: '💰',
    type: 'signal',
    pattern: /full refund|refund all|money back|complete refund|100% refund|entire refund/i,
  },
  {
    key: 'proof',
    label: 'Cites proof',
    icon: '📷',
    type: 'signal',
    pattern: /\bphotos?\b|\bpictures?\b|\bvideo\b|attach(ed|ing|ment)?|evidence|\bproof\b|screenshot/i,
  },
  {
    key: 'china_return',
    label: 'Return-to-China friction',
    icon: '📦',
    type: 'signal',
    pattern: /return.{0,20}china|ship.{0,20}china|pay.{0,20}return shipping|return label|prepaid label/i,
  },
];

const SENDER_BLOCKLIST = [
  'shopify.com', 'trustpilot', 'reamaze.com', 'chargeflow',
  'no-reply', 'noreply', 'notifications@', 'mailer@', 'billing@',
  'do-not-reply', 'bol.com', 'klaviyo', 'mailchimp', 'gorgias', 'postmaster',
  'judge.me', 'yotpo', 'okendo', 'loox', 'stamped', 'junip', 'fera.ai', 'omnisend',
];

export function isSystemSender(email?: string | null): boolean {
  if (!email) return true;
  const e = email.toLowerCase();
  return SENDER_BLOCKLIST.some((b) => e.includes(b));
}

export interface DetectedTrigger {
  key: string;
  label: string;
  icon: string;
  type: TriggerType;
}

export function detectTriggers(text: string): DetectedTrigger[] {
  if (!text) return [];
  return TRIGGERS.filter((t) => t.pattern.test(text)).map(({ key, label, icon, type }) => ({
    key, label, icon, type,
  }));
}

const SEVERITY: Record<string, number> = {
  chargeback: 50,
  legal: 20,
  ultimatum: 18,
  scam: 16,
  review: 15,
  full_refund: 6,
  proof: 4,
  china_return: 4,
};

export function computeSeverity(
  triggers: DetectedTrigger[],
  repeatDisputer: boolean,
  firstOrder: boolean,
): number {
  let s = triggers.reduce((acc, t) => acc + (SEVERITY[t.key] ?? 0), 0);
  if (repeatDisputer) s += 40;
  if (firstOrder) s += 5;
  return s;
}
