import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Redis } from '@upstash/redis';

export const ADVERTORIAL_PAGE_ID = 173315916102;
const API_VERSION = '2024-10';
const SNAPSHOT_PATH = 'snapshots/herd_advertorial_stable.html';
const DRIFT_LOG_KEY = 'herd:advertorial:drift_log';

type CachedToken = { token: string; expiresAt: number };
let tokenCache: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const store = process.env.HERDELICA_SHOPIFY_STORE;
  const clientId = process.env.HERDELICA_SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.HERDELICA_SHOPIFY_CLIENT_SECRET;
  if (!store || !clientId || !clientSecret) {
    throw new Error('Herdelica Shopify env vars missing.');
  }
  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function adminFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  const store = process.env.HERDELICA_SHOPIFY_STORE!;
  const token = await getAccessToken();
  return fetch(`https://${store}/admin/api/${API_VERSION}/${endpoint}`, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export async function readSnapshot(): Promise<string> {
  const abs = path.join(process.cwd(), SNAPSHOT_PATH);
  return fs.readFile(abs, 'utf8');
}

interface LivePage {
  body: string;
  updatedAt: string;
}

async function fetchLive(): Promise<LivePage> {
  const res = await adminFetch(`pages/${ADVERTORIAL_PAGE_ID}.json`);
  if (!res.ok) throw new Error(`Live fetch failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { page: { body_html: string; updated_at: string } };
  return { body: data.page.body_html, updatedAt: data.page.updated_at };
}

async function pushBody(body: string): Promise<{ updatedAt: string; length: number }> {
  const res = await adminFetch(`pages/${ADVERTORIAL_PAGE_ID}.json`, {
    method: 'PUT',
    body: JSON.stringify({ page: { id: ADVERTORIAL_PAGE_ID, body_html: body } }),
  });
  if (!res.ok) throw new Error(`Push failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { page: { body_html: string; updated_at: string } };
  return { updatedAt: data.page.updated_at, length: data.page.body_html.length };
}

export interface InstalledApp {
  id: number;
  name: string;
  scope: string;
  canWritePages: boolean;
}

async function listAppsWithPageWrite(): Promise<InstalledApp[]> {
  try {
    const res = await adminFetch('graphql.json', {
      method: 'POST',
      body: JSON.stringify({
        query: `{
          currentAppInstallation { app { id title } accessScopes { handle } }
          appInstallations(first: 50) {
            edges { node { app { id title } accessScopes { handle } } }
          }
        }`,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: {
        appInstallations?: {
          edges: Array<{ node: { app: { id: string; title: string }; accessScopes: Array<{ handle: string }> } }>;
        };
      };
    };
    const apps: InstalledApp[] = [];
    for (const e of data.data?.appInstallations?.edges || []) {
      const scopes = e.node.accessScopes.map((s) => s.handle);
      const canWritePages =
        scopes.includes('write_online_store_pages') || scopes.includes('write_content');
      apps.push({
        id: parseInt(e.node.app.id.split('/').pop() || '0', 10),
        name: e.node.app.title,
        scope: scopes.join(','),
        canWritePages,
      });
    }
    return apps;
  } catch {
    return [];
  }
}

interface DriftEvent {
  detectedAt: string;
  liveUpdatedAt: string;
  liveSha: string;
  snapSha: string;
  liveLength: number;
  snapLength: number;
  diffSummary: string;
  rolledBack: boolean;
  rollbackUpdatedAt?: string;
}

function summarizeDiff(live: string, snap: string): string {
  const markers = [
    { key: 'hd-kaching-mount', label: 'Kaching mount' },
    { key: 'appendCurrencySuffix', label: 'currency suffix JS' },
    { key: 'equalizeBars', label: 'equalizeBars JS' },
    { key: 'product-info__price hd-price-native', label: 'native price wrapper' },
    { key: 'is="custom-button"', label: 'native ATC button' },
    { key: 'hd-author-img', label: 'author photo' },
    { key: 'Lactobacillus rhamnosus', label: 'reason 5 strains text' },
    { key: '14 months and 11 UTIs', label: 'reason 3 backstory' },
    { key: 'The quiet shift that', label: 'subhead text' },
    { key: 'in 2026', label: 'headline year 2026' },
  ];
  const missing: string[] = [];
  for (const m of markers) {
    if (snap.includes(m.key) && !live.includes(m.key)) missing.push(m.label);
  }
  const lenDelta = live.length - snap.length;
  let summary = `length ${live.length} vs ${snap.length} (${lenDelta >= 0 ? '+' : ''}${lenDelta})`;
  if (missing.length) summary += `; missing: ${missing.join(', ')}`;
  return summary;
}

export interface HealthResult {
  ok: boolean;
  identical: boolean;
  liveLength: number;
  snapLength: number;
  liveSha: string;
  snapSha: string;
  liveUpdatedAt: string;
  drift?: {
    diffSummary: string;
    rolledBack: boolean;
    rollbackUpdatedAt?: string;
    suspectApps: InstalledApp[];
  };
  recentDrifts?: DriftEvent[];
}

export async function checkAdvertorialHealth(opts: { rollback: boolean }): Promise<HealthResult> {
  const [snap, live] = await Promise.all([readSnapshot(), fetchLive()]);
  const snapSha = sha256(snap);
  const liveSha = sha256(live.body);
  const identical = snapSha === liveSha;

  const result: HealthResult = {
    ok: true,
    identical,
    liveLength: live.body.length,
    snapLength: snap.length,
    liveSha: liveSha.slice(0, 16),
    snapSha: snapSha.slice(0, 16),
    liveUpdatedAt: live.updatedAt,
  };

  if (!identical) {
    const diffSummary = summarizeDiff(live.body, snap);
    let rolledBack = false;
    let rollbackUpdatedAt: string | undefined;
    if (opts.rollback) {
      const pushed = await pushBody(snap);
      rolledBack = true;
      rollbackUpdatedAt = pushed.updatedAt;
    }
    const suspectApps = (await listAppsWithPageWrite()).filter((a) => a.canWritePages);
    const event: DriftEvent = {
      detectedAt: new Date().toISOString(),
      liveUpdatedAt: live.updatedAt,
      liveSha: liveSha.slice(0, 16),
      snapSha: snapSha.slice(0, 16),
      liveLength: live.body.length,
      snapLength: snap.length,
      diffSummary,
      rolledBack,
      rollbackUpdatedAt,
    };
    // Log naar Redis (laatste 50 events)
    const redis = getRedis();
    if (redis) {
      try {
        await redis.lpush(DRIFT_LOG_KEY, JSON.stringify(event));
        await redis.ltrim(DRIFT_LOG_KEY, 0, 49);
      } catch {
        // ignore
      }
    }
    result.drift = { diffSummary, rolledBack, rollbackUpdatedAt, suspectApps };
  }

  // Altijd recente drifts meegeven voor patroon-analyse
  const redis = getRedis();
  if (redis) {
    try {
      const raw = (await redis.lrange<string>(DRIFT_LOG_KEY, 0, 19)) || [];
      result.recentDrifts = raw
        .map((r) => {
          try {
            return typeof r === 'string' ? (JSON.parse(r) as DriftEvent) : (r as DriftEvent);
          } catch {
            return null;
          }
        })
        .filter((x): x is DriftEvent => x !== null);
    } catch {
      // ignore
    }
  }

  return result;
}
