import { STORES, getShopifyAccessToken } from './shopify';
import { cached } from './cache';

const GENDER_TAGS = new Set(['men', 'women', 'male', 'female', 'unisex', 'man', 'woman', 'boys', 'girls', 'kids', 'mens', 'womens']);
const BLACKLISTED_TAGS = new Set(['newproductsguy']);
const SIZE_RE = /^(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|one size)$/i;
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$|^\d{2}[/-]\d{2}[/-]\d{4}$|^\d{2}-\d{4}$/;

function extractBrand(tagsStr: string): string | undefined {
  if (!tagsStr) return undefined;
  const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
  return tags.find(t => {
    const lower = t.toLowerCase();
    if (GENDER_TAGS.has(lower) || BLACKLISTED_TAGS.has(lower)) return false;
    if (SIZE_RE.test(t) || DATE_RE.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (t.includes('-') || t.includes('_')) return false;
    return true;
  });
}

export interface ShopifyProductBasic {
  id: string;
  title: string;
  status: 'active' | 'archived' | 'draft';
  variantCount: number;
  variantIds: string[];
  imageUrl?: string;
  brandName?: string;
}

export function fetchAllShopifyProducts(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
): Promise<ShopifyProductBasic[]> {
  return cached(
    `shopify:all-products:v2:${storeKey}`,
    120,
    () => fetchAllShopifyProductsUncached(storeKey),
  );
}

async function fetchAllShopifyProductsUncached(
  storeKey: 'luhvia' | 'cecole' | 'luvande',
): Promise<ShopifyProductBasic[]> {
  const cfg = STORES[storeKey];
  const token = await getShopifyAccessToken(storeKey);
  const all: ShopifyProductBasic[] = [];
  let pageInfo: string | null = null;
  let isFirst = true;

  while (true) {
    let url: string;
    if (isFirst) {
      url = `https://${cfg.store}/admin/api/2024-04/products.json?limit=250&fields=id,title,status,variants,image,tags`;
      isFirst = false;
    } else if (pageInfo) {
      url = `https://${cfg.store}/admin/api/2024-04/products.json?page_info=${pageInfo}&limit=250&fields=id,title,status,variants,image,tags`;
    } else {
      break;
    }

    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Shopify all products ${storeKey}: ${res.status}`);
    const data = await res.json();

    for (const p of data.products || []) {
      const s = (p.status || '').toLowerCase();
      all.push({
        id: String(p.id),
        title: p.title ?? '',
        status: s === 'active' || s === 'archived' || s === 'draft' ? s : 'active',
        variantCount: Array.isArray(p.variants) ? p.variants.length : 0,
        variantIds: Array.isArray(p.variants) ? p.variants.map((v: any) => String(v.id)) : [],
        imageUrl: p.image?.src,
        brandName: extractBrand(p.tags || ''),
      });
    }

    const nextMatch = res.headers.get('Link')?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
    if (!pageInfo) break;
  }

  return all;
}
