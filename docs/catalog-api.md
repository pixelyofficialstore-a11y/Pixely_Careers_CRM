# Public catalog API

The CRM keeps one price list (packages and add-ons) in the `public.catalog_items` table. Admins edit it in **Settings → Catalog → Prices**. The Create Order form reads it now. pixelycareers.com can read the same list later, so prices only need to be changed in one place.

## Endpoint

```
GET https://<crm-host>/api/public/catalog
GET https://<crm-host>/api/public/catalog?market=pk
GET https://<crm-host>/api/public/catalog?market=intl
```

- **No login.** The endpoint is read-only and returns only items marked *Active*.
- **CORS:** allowed for `https://pixelycareers.com` and `https://www.pixelycareers.com`. Calls from a server don't need CORS.
- **Caching:** `Cache-Control: public, max-age=300`, so a price change shows within about 5 minutes.
- **`market` (optional):** `pk` or `intl`. Leave it out to get every market.

## Response

```json
{
  "version": 1,
  "updatedAt": "2026-11-12T09:30:00.000Z",
  "items": [
    {
      "kind": "package",
      "key": "ats_career",
      "websiteKey": "ats-career",
      "label": "ATS Career Package",
      "description": "ATS CV + cover letter + LinkedIn",
      "price": 450000,
      "priceMajor": 4500,
      "currency": "PKR",
      "market": "pk",
      "services": ["ATS CV", "Cover Letter", "LinkedIn Optimization"],
      "deliveryDays": 2
    },
    {
      "kind": "addon",
      "key": "express",
      "websiteKey": null,
      "label": "Express delivery",
      "description": null,
      "price": 100000,
      "priceMajor": 1000,
      "currency": "PKR",
      "market": "pk",
      "services": [],
      "deliveryDays": null
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | Response format version. It changes only on breaking changes. |
| `updatedAt` | Newest edit across the active items. Use it as a cache key. |
| `kind` | `package` or `addon`. |
| `key` | Stable CRM key. It never changes after the item is created. |
| `websiteKey` | The website's own slug, if it differs from `key`. Match on this first. |
| `price` | **Minor units** (paisa / cents), as an integer. |
| `priceMajor` | `price / 100`, for display (rupees / dollars). |
| `currency` | ISO code, e.g. `PKR` or `USD`. |
| `market` | `pk` or `intl`. |
| `services` | The services the package includes. |
| `deliveryDays` | Delivery time shown to the client. `null` means the CRM's package default applies. |

Items are sorted by kind, then by the admin's sort order, then by name.

## Notes for the website

- Keep the website's checkout `total` in **rupees**, as it is today. The CRM converts it ×100 to paisa when it reads `website.orders`. The catalog is a separate list.
- Items are never deleted. A retired item is switched off and drops out of this response. The website should treat a missing key as "no longer sold".
- The CRM-only endpoint `GET /api/catalog` needs a login and also returns inactive items to admins. Use the public endpoint on the website.
