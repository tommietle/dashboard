export interface ReamazeMessage {
  body: string;
  createdAt: string;
}

export interface ReamazeConversation {
  id: string;
  number: number;
  subject: string;
  customerName: string;
  customerEmail: string;
  updatedAt: string;
  url: string;
  messages: ReamazeMessage[];
}

function authHeader(): string {
  const email = process.env.REAMAZE_LOGIN_EMAIL!;
  const token = process.env.REAMAZE_API_TOKEN!;
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

function baseUrl(): string {
  const brand = process.env.REAMAZE_BRAND;
  if (!brand) throw new Error('REAMAZE_BRAND env var is niet ingesteld.');
  return `https://${brand}.reamaze.com/api/v1`;
}

async function get(path: string): Promise<any> {
  const res = await fetch(baseUrl() + path, {
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Re:amaze API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Fetches conversations updated in the last `days` days across all pages (max 8).
export async function fetchRecentConversations(days = 14): Promise<ReamazeConversation[]> {
  if (!process.env.REAMAZE_LOGIN_EMAIL || !process.env.REAMAZE_API_TOKEN) {
    throw new Error('REAMAZE_LOGIN_EMAIL of REAMAZE_API_TOKEN ontbreekt.');
  }

  const brand   = process.env.REAMAZE_BRAND || '';
  const cutoff  = new Date(Date.now() - days * 86400_000).toISOString();
  const results: ReamazeConversation[] = [];
  let page = 1;

  while (page <= 8) {
    const data = await get(`/conversations?page=${page}&sort=updated`);
    const convs: any[] = data.conversations || [];
    if (convs.length === 0) break;

    let hitCutoff = false;
    for (const c of convs) {
      // Stop paging once conversations are older than cutoff
      if (c.updated_at < cutoff) { hitCutoff = true; break; }

      const contact = c.contact || {};
      const messages: ReamazeMessage[] = (c.messages || []).map((m: any) => ({
        body: String(m.body || m.html_body || ''),
        createdAt: m.created_at || '',
      }));

      results.push({
        id:            String(c.id),
        number:        c.number,
        subject:       c.subject || '(geen onderwerp)',
        customerName:  contact.name || contact.email || 'Onbekend',
        customerEmail: contact.email || '',
        updatedAt:     c.updated_at || '',
        url:           brand ? `https://${brand}.reamaze.com/a/${brand}/conversations/${c.slug || c.number}` : '#',
        messages,
      });
    }

    if (hitCutoff || !data.next_page) break;
    page++;
  }

  return results;
}
