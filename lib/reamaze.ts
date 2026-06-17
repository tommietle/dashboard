// Re:amaze support-desk client.
//
// Re:amaze runs as a multi-brand account: each store has its own "brand"
// (subdomain). Note Luhvia's brand slug is "luvia" (not "luhvia") and
// Modemeister's is "modemeisteroutlet".
// Auth = HTTP Basic with a login email + API token.
//
// Required env vars:
//   REAMAZE_LOGIN_EMAIL   – an admin/staff login email
//   REAMAZE_API_TOKEN     – REST API token (Re:amaze → Settings → Developer/API)
// Optional brand overrides:
//   REAMAZE_BRAND_LUHVIA (default "luvia"), _CECOLE ("cecole"),
//   _LUVANDE ("luvande"), _MODEMEISTER ("modemeisteroutlet")

export type ShopKey = 'luhvia' | 'cecole' | 'luvande' | 'modemeister';

export const REAMAZE_BRANDS: Record<ShopKey, string> = {
  luhvia:      process.env.REAMAZE_BRAND_LUHVIA      || 'luvia',
  cecole:      process.env.REAMAZE_BRAND_CECOLE      || 'cecole',
  luvande:     process.env.REAMAZE_BRAND_LUVANDE     || 'luvande',
  modemeister: process.env.REAMAZE_BRAND_MODEMEISTER || 'modemeisteroutlet',
};

function creds(): { email: string; token: string } | null {
  const email = process.env.REAMAZE_LOGIN_EMAIL;
  const token = process.env.REAMAZE_API_TOKEN;
  return email && token ? { email, token } : null;
}

export function isReamazeConfigured(): boolean {
  return creds() !== null;
}

function authHeader(): string {
  const c = creds();
  if (!c) throw new Error('Re:amaze not configured (REAMAZE_LOGIN_EMAIL / REAMAZE_API_TOKEN).');
  return 'Basic ' + Buffer.from(`${c.email}:${c.token}`).toString('base64');
}

async function reamazeGet<T = unknown>(brand: string, path: string): Promise<T> {
  const res = await fetch(`https://${brand}.reamaze.io/api/v1/${path}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Re:amaze ${brand} ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface ReamazeAuthor {
  email?: string;
  name?: string;
  'staff?'?: boolean;
}

export interface ReamazeMessage {
  body?: string;
  created_at?: string;
  user?: ReamazeAuthor;
}

export interface ReamazeConversation {
  subject: string;
  slug: string;
  created_at: string;
  updated_at: string;
  status?: number;
  perma_url?: string;
  author?: ReamazeAuthor;
  last_customer_message?: ReamazeMessage | null;
  message?: ReamazeMessage | null;
}

export async function fetchRecentConversations(
  brand: string,
  pages = 4,
): Promise<ReamazeConversation[]> {
  const out: ReamazeConversation[] = [];
  for (let page = 1; page <= pages; page++) {
    const data = await reamazeGet<{ conversations?: ReamazeConversation[] }>(
      brand,
      `conversations?page=${page}`,
    );
    const convs = data.conversations || [];
    if (convs.length === 0) break;
    out.push(...convs);
  }
  return out;
}

export async function fetchCustomerConversations(
  brand: string,
  email: string,
): Promise<ReamazeConversation[]> {
  const data = await reamazeGet<{ conversations?: ReamazeConversation[] }>(
    brand,
    `conversations?for=${encodeURIComponent(email)}`,
  );
  return data.conversations || [];
}

export async function fetchConversationMessages(
  brand: string,
  slug: string,
): Promise<ReamazeMessage[]> {
  const data = await reamazeGet<{ messages?: ReamazeMessage[] }>(
    brand,
    `conversations/${encodeURIComponent(slug)}/messages`,
  );
  return data.messages || [];
}

export function htmlToText(s?: string | null): string {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
