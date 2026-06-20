import { STORES, getShopifyAccessToken, isShopifyConfigured } from './shopify';
import { getCachedMany, setCachedValue, invalidateCache } from './cache';

export type ShopifyProductStatus = 'active' | 'archived' | 'draft' | 'unknown';

export interface ShopifyProductMeta {
  status: ShopifyProductStatus;
  variantCount: number;
  imageUrl?: string;
  brandName?: string;
}

const GENDER_TAGS = new Set(['men', 'women', 'male', 'female', 'unisex', 'man', 'woman', 'boys', 'girls', 'kids', 'mens', 'womens']);
const BLACKLISTED_TAGS = new Set(['newproductsguy']);
const SIZE_RE = /^(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|one size)$/i;
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$|^\d{2}[/-]\d{2}[/-]\d{4}$|^\d{2}-\d{4}$/;

function extractBrandFromTags(tagsStr: string): string | undefined {
  if (!tagsStr) return undefined;
  const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
  return tags.find(t => {
    const lower = t.toLowerCase();
    if (GENDER_TAGS.has(lower)) return false;
    if (BLACKLISTED_TAGS.has(lower)) return false;
    if (SIZE_RE.test(t)) return false;
    if (DATE_RE.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (t.includes('-') || t.includes('_')) return false;
    return true;
  });
}

// Shopify REST staat tot 250 product-IDs per request toe.
const BATCH_SIZE = 250;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Haalt status / variantCount / imageUrl op voor een lijst Shopify product-IDs.
// Onbekende IDs (bv. handmatig ingevoerde item-ID's in Google Ads) blijven gewoon weg uit de map.
export async function fetchShopifyProductMeta(
  storeKey: 'luhvia' | 'cecole' | 'luvande' | 'modemeister',
  productIds: string[],
): Promise<Map<string, ShopifyProductMeta>> {
  const cfg = STORES[storeKey];
  if (!cfg?.store || !isShopifyConfigured(storeKey)) {
    return new Map();
  }

  const cleaned = Array.from(new Set(productIds.filter(id => /^\d+$/.test(id))));
  if (cleaned.length === 0) return new Map();

  // Cache per individuele productId voor 2 min. Één MGET in plaats van N GETs.
  const result = new Map<string, ShopifyProductMeta>();
  const missing: string[] = [];

  const cacheKeys = cleaned.map(id => `shopify:product-meta:v6:${storeKey}:${id}`);
  const cached = await getCachedMany<ShopifyProductMeta>(cacheKeys);
  for (const id of cleaned) {
    const hit = cached.get(`shopify:product-meta:v6:${storeKey}:${id}`);
    if (hit) result.set(id, hit);
    else missing.push(id);
  }

  if (missing.length === 0) return result;

  const token = await getShopifyAccessToken(storeKey);

  function buildMeta(p: any): ShopifyProductMeta {
    const rawStatus = (p.status || '').toLowerCase();
    return {
      status: rawStatus === 'active' || rawStatus === 'archived' || rawStatus === 'draft'
        ? rawStatus : 'unknown',
      variantCount: Array.isArray(p.variants) ? p.variants.length : 0,
      imageUrl: p.image?.src,
      brandName: extractBrandFromTags(p.tags || ''),
    };
  }

  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  await Promise.all(chunk(missing, BATCH_SIZE).map(async batch => {
    const seenInBatch = new Set<string>();

    // Stap 1: zoek op als product IDs
    const prodRes = await fetch(
      `https://${cfg.store}/admin/api/2024-04/products.json?ids=${batch.join(',')}&limit=${BATCH_SIZE}&fields=id,status,variants,image,tags`,
      { headers, cache: 'no-store' },
    );
    if (prodRes.ok) {
      for (const p of (await prodRes.json()).products || []) {
        const id = String(p.id);
        seenInBatch.add(id);
        const meta = buildMeta(p);
        result.set(id, meta);
        void setCachedValue(`shopify:product-meta:v6:${storeKey}:${id}`, meta, 120);
      }
    } else {
      console.error(`Shopify product meta ${storeKey}: ${prodRes.status}`);
    }

    // Stap 2: niet-gevonden IDs proberen als variant IDs
    const notFound = batch.filter(id => !seenInBatch.has(id));
    if (notFound.length > 0) {
      const varRes = await fetch(
        `https://${cfg.store}/admin/api/2024-04/variants.json?ids=${notFound.join(',')}&limit=${BATCH_SIZE}&fields=id,product_id`,
        { headers, cache: 'no-store' },
      );
      if (varRes.ok) {
        const varToProduct = new Map<string, string>();
        for (const v of (await varRes.json()).variants || []) {
          varToProduct.set(String(v.id), String(v.product_id));
        }
        const parentIds = Array.from(new Set(varToProduct.values()));
        if (parentIds.length > 0) {
          const parentRes = await fetch(
            `https://${cfg.store}/admin/api/2024-04/products.json?ids=${parentIds.join(',')}&limit=${BATCH_SIZE}&fields=id,status,variants,image,tags`,
            { headers, cache: 'no-store' },
          );
          if (parentRes.ok) {
            const parentMetaById = new Map<string, ShopifyProductMeta>();
            for (const p of (await parentRes.json()).products || []) {
              parentMetaById.set(String(p.id), buildMeta(p));
            }
            for (const variantId of notFound) {
              const productId = varToProduct.get(variantId);
              if (productId && parentMetaById.has(productId)) {
                const meta = parentMetaById.get(productId)!;
                result.set(variantId, meta);
                void setCachedValue(`shopify:product-meta:v6:${storeKey}:${variantId}`, meta, 120);
                seenInBatch.add(variantId);
              }
            }
          }
        }
      }
    }

    // Stap 3: overgebleven niet-gevonden IDs kort cachen als unknown
    for (const id of batch) {
      if (!seenInBatch.has(id)) {
        const meta: ShopifyProductMeta = { status: 'unknown', variantCount: 0 };
        void setCachedValue(`shopify:product-meta:v6:${storeKey}:${id}`, meta, 120);
      }
    }
  }));

  return result;
}

// Zet de Shopify-status van een product (active / archived / draft).
// Gebruikt GraphQL productChangeStatus i.p.v. REST products/update PUT:
// die laatste her-valideert ALLE velden (incl. lege variant-SKU's) en faalt dan
// met 422 "sku can't be blank". productChangeStatus muteert alleen status.
export async function setShopifyProductStatus(
  storeKey: 'luhvia' | 'cecole' | 'luvande' | 'modemeister',
  productId: string,
  status: 'active' | 'archived' | 'draft',
): Promise<void> {
  const cfg = STORES[storeKey];
  if (!cfg?.store || !isShopifyConfigured(storeKey)) {
    throw new Error(`Shopify niet geconfigureerd voor ${storeKey}.`);
  }

  const token = await getShopifyAccessToken(storeKey);
  const url = `https://${cfg.store}/admin/api/2024-04/graphql.json`;
  const mutation = `
    mutation ChangeStatus($id: ID!, $status: ProductStatus!) {
      productChangeStatus(productId: $id, status: $status) {
        product { id status }
        userErrors { field message }
      }
    }
  `;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        id: `gid://shopify/Product/${productId}`,
        status: status.toUpperCase(),
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Shopify update ${storeKey}/${productId}: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const userErrors = data?.data?.productChangeStatus?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(`Shopify update ${storeKey}/${productId}: ${userErrors.map((e: any) => `${e.field?.join('.') || ''} ${e.message}`).join('; ')}`);
  }
  if (data?.errors) {
    throw new Error(`Shopify update ${storeKey}/${productId}: ${JSON.stringify(data.errors).slice(0, 200)}`);
  }

  // Cache invalideren zodat de UI direct de nieuwe status ziet.
  await invalidateCache(`shopify:product-meta:v6:${storeKey}:${productId}`);
  await invalidateCache(`shopify:all-products:v3:${storeKey}`);
}
