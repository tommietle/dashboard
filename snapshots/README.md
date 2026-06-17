# Herdelica advertorial — snapshots

Last-known-good versies van de advertorial page body (`/pages/173315916102`).
Bij problemen: rollback via

```
TOKEN=$(cat /tmp/herd_token)
python3 -c "
import json
with open('snapshots/herd_advertorial_stable.html') as f:
    body = f.read()
with open('/tmp/rollback.json','w') as f:
    json.dump({'page':{'id':173315916102,'body_html':body}}, f)
"
curl -X PUT "https://ameycu-y0.myshopify.com/admin/api/2024-10/pages/173315916102.json" \
  -H "X-Shopify-Access-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/rollback.json
```

## Wat MOET in elke versie staan (pre-flight check)
- `appendCurrencySuffix` — currency suffix observer
- `equalizeBars` — bundel equal-height JS (zonder MutationObserver op body)
- `hd-author-img` — Sarah's foto
- `product-info__price hd-price-native` — native price wrapper voor Kaching
- `hd-kaching-mount` — Kaching mount point
- `is="custom-button"` — Shopify native ATC met automatische prijs

## Wat NIET in een versie mag voorkomen (anti-regression)
- `setInterval` — kan loops veroorzaken
- `document.body, {childList:true,subtree:true}` als observe target voor price/equalize — body-wide observer was de witruimte-bug
- `hd-atc-price` — eigen price span maakte ATC button dubbel
- `VERVANG` — placeholder tekst
- `hd-eyebrow">Editorial` — eyebrow is verwijderd
- `hd-hero-img" src` — hero image bovenaan is verwijderd

## Health-check & auto-rollback (Vercel cron)

Endpoint: `GET /api/herdelica/advertorial-health?rollback=1`
Cron: elk uur (`vercel.json` → `0 * * * *`)

Required env vars (Vercel project + `.env.local`):
- `HERDELICA_SHOPIFY_STORE` — `ameycu-y0.myshopify.com`
- `HERDELICA_SHOPIFY_CLIENT_ID` — client_credentials app
- `HERDELICA_SHOPIFY_CLIENT_SECRET`

Optional:
- `CRON_SECRET` — als gezet, vereist `?secret=...` of `Authorization: Bearer ...` voor de `rollback=1` variant
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (of `KV_REST_API_URL` + `KV_REST_API_TOKEN`) — drift event log (laatste 50)

Drift events worden gelogd in Redis (laatste 50). Bekijk via `GET /api/herdelica/advertorial-health` (zonder `rollback=1`) → `recentDrifts` in de JSON response.
