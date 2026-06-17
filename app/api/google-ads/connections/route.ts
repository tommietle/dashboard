import { NextRequest, NextResponse } from 'next/server';
import { getAllConnections, removeConnection } from '@/lib/adsConnections';

const CUSTOMER_IDS: Record<string, string | undefined> = {
  luhvia:  process.env.LUHVIA_GOOGLE_ADS_CUSTOMER_ID,
  cecole:  process.env.CECOLE_GOOGLE_ADS_CUSTOMER_ID,
  luvande: process.env.LUVANDE_GOOGLE_ADS_CUSTOMER_ID,
};

// Status van de koppelingen voor de Instellingen-pagina.
// Let op: de refresh token wordt nooit naar de client gestuurd.
export async function GET() {
  const all = await getAllConnections();
  const stores = ['luhvia', 'cecole', 'luvande'].map((store) => {
    const c = all[store];
    return {
      store,
      customerId: CUSTOMER_IDS[store] || null,
      connected: Boolean(c),
      email: c?.email || null,
      connectedAt: c?.connectedAt || null,
      accessibleCustomers: c?.accessibleCustomers || [],
    };
  });
  return NextResponse.json({ stores });
}

export async function DELETE(req: NextRequest) {
  const store = req.nextUrl.searchParams.get('store') || '';
  if (store !== 'luhvia' && store !== 'cecole' && store !== 'luvande') {
    return NextResponse.json({ error: 'Onbekende store' }, { status: 400 });
  }
  await removeConnection(store);
  return NextResponse.json({ ok: true });
}
