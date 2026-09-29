# Long-Tail Ops

Internal operating tool for Snitch long-tail categories (Perfumes and Shoes first). It covers store performance, targets,
SKU performance, and an action centre of exceptions.

- **Next.js 16** (App Router, server components), TypeScript, Tailwind v4, Recharts, TanStack Virtual
- **Snowflake** is the analytical source of truth. It is queried server-side only and results are cached in memory.
- **PostgreSQL** holds application data: target overrides and history, users and roles, settings, saved views, and the audit log.
- **Auth** is Sign in with Google, limited to allowed email addresses (any Gmail or Workspace account on the list).

See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for the source-table audit, joins, data-quality findings and metric definitions.

## Views

| Area | Routes |
|---|---|
| Performance | `/` executive overview · `/performance/daily` · `/performance/weekly` · `/performance/mtd` |
| Stores | `/stores` · `/stores/[branch]` detail · `/stores/matrix` (store × category) · `/stores/sku` |
| Products | `/products/skus` · `/products/skus/[sku]` · `/products/bible` · `/products/categories` |
| Targets | `/targets` · `/targets/stores` · `/targets/daily` (store × day heatmap) · `/targets/weekly` · `/targets/setup` (editor) |
| Action Centre | `/exceptions` (stores) · `/exceptions/skus` · `/exceptions/targets` · `/exceptions/zero-sale` |
| Admin | `/admin/settings` · `/admin/users` |

Global filters live in the URL (`?p=mtd&cat=shoes&region=South…`). They carry across the sidebar and into drill-downs. Every
table supports search, sort, a column picker, a sticky header and CSV export.

## Code layout

```
src/lib/            pure helpers: dates, formatting, metrics, filters, category registry, nav
src/server/         server-only
  snowflake.ts      pooled Snowflake client + cached queries
  db/               pg pool + migrations (auto-applied on boot)
  data/             source access: stores, facts (store×cat×day + targets), sku, products, targets, freshness
  analytics.ts      aggregation (summaries, month outlook, store rows)
  views.ts          view builders shared by pages
  exceptions.ts     exception rules
src/app/            pages + API routes (/api/targets, /api/targets/upload, /api/targets/template, /api/admin/*, /api/health)
src/components/     DataTable, FilterBar, charts, target editor, admin forms
```

All SQL lives in `src/server/data/*`. Pages never build SQL.

## Adding a category

1. Add an entry to `CATEGORIES` in `src/lib/categories.ts`.
   - `source: "dsr"` needs a DSR table and a daily target table with the same shape as perfumes/shoes.
   - `source: "sales"` builds store-day facts from `HORIZONTAL_SALES_CATEGORIES` (no bills). Targets are set in Target Setup.
2. Enable it in **Admin → Settings → Categories**.

Sunglasses, Belts, Bags, Accessories and Luggage are already registered as `sales` categories and are disabled by default.

## Local development

```bash
cp .env.example .env.local   # fill SNOWFLAKE_*; set AUTH_MODE=dev and DEV_USER_EMAIL for local use
npm install
npm run db:local             # optional: PGlite on :5433 (dev only; set PG_POOL_MAX=1)
npm run dev
```

## Deploying on Coolify

1. Push this repo to GitHub, then in Coolify choose **New Resource → Application → GitHub** with the **Dockerfile** build pack. Port: `3000`.
2. Add a **PostgreSQL** resource in the same project and set `DATABASE_URL` to its internal connection string. Migrations run on boot.
3. Set the environment variables from `.env.example`:
   - `SNOWFLAKE_*`, including `SNOWFLAKE_PAT`. This account's auth policy rejects key-pair auth for `N8N_OPS`.
   - `AUTH_MODE=google`, `NEXTAUTH_URL` (the public https URL), `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `ADMIN_EMAILS`, `ALLOWED_EMAILS`, and optionally `ALLOWED_EMAIL_DOMAINS`
4. In Google Cloud Console, open the OAuth client (type **Web application**) and add the authorised redirect URI
   `https://<your-domain>/api/auth/callback/google`.
5. The health check is `GET /api/health`, which is already wired into the Dockerfile.

`docker-compose.yml` runs the app together with Postgres, for a single-box or Compose-based deployment.

## Roles

Sign-in is limited to `ADMIN_EMAILS`, `ALLOWED_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, and users an admin adds in **Users & Access**.
Revoking someone (removing them from the list, or clicking Disable) takes effect within a minute.

- **viewer**: the default for any allowed user.
- **editor**: can create, override and upload targets.
- **admin**: can manage settings and users. Bootstrap admins with `ADMIN_EMAILS`.
