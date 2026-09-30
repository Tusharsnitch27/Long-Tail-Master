# Long Tail

**Building the next ₹100 Cr business.** Long Tail is the operating tool for Snitch's long-tail categories: Accessories, Bags, Belts,
Perfumes, Shoes (incl. Footwear), Sunglasses and Trolleys. It covers Stores, Online (Shopify) and Marketplaces (AJIO, Myntra, Flipkart, Amazon).

- **Next.js 16** (App Router, server components), TypeScript, Tailwind v4 (Ocean Teal theme), Recharts, TanStack Virtual
- **Snowflake** is the analytical source of truth. It is queried server-side only and cached in memory (stale-while-revalidate).
- **PostgreSQL** holds app data: targets, daily splits, store targets, remarks, action status, VM revamps, future inwards, attribute edits, users and the change log.
- **Auth** is username + password. Admins create accounts in the Control Centre; the two roles are admin and viewer.

See [docs/SNITCH_LONGTAIL.md](docs/SNITCH_LONGTAIL.md) for scope, the source map, targets logic, the metric dictionary and the question each page
answers. Rules and their current values are listed in the app under Control Centre → Rules & data.

## Mitra (AI)

`/mitra` answers natural-language questions with Claude (`AI_MODEL`, default `claude-opus-5-5`). By default Claude runs
through **Snowflake Cortex's Anthropic-compatible endpoint**, authenticated with the same `SNOWFLAKE_PAT` and billed to Snowflake
credits, so no Anthropic API key is needed (`AI_PROVIDER=snowflake`). Set `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` to call
Anthropic directly. The model never queries Snowflake itself: it calls approved tools that run governed queries.

| Tool | Answers |
|---|---|
| `resolve_product` / `resolve_location` | Entity resolution with confidence and typo tolerance. Ambiguous or low-confidence matches are shown, not guessed |
| `get_performance` | Store-level revenue, target, achievement, growth, productivity, and trends by day, week or month (DSR + targets) |
| `get_sku_performance` | SKU and product sales, penetration, L7/L30/MTD, last sale (horizontal sales) |
| `get_current_inventory` | Latest snapshot only. Network level per SKU (`INVENTORY_DAILY_SNAPSHOT_LATEST`) or store level (`SPEED_INVENTORY`, ~20-store feed) |
| `get_exceptions` | Action-centre lists, including stocked-but-not-selling |
| `explain_change` | Driver decomposition for "why" questions. It lists the drivers it can't check instead of inventing causes |
| `submit_answer` | Structured answer: text, metrics, insights, actions, views, limitations, follow-ups |

Views reference tool results by id, and the server fills in the rows, so charts and tables only ever show queried data.
Conversations are stored server-side (`ai_conversations`, `ai_turns`) with tool calls, token usage and 👍/👎 feedback.
The semantic layer (datasets, metrics and their time behaviour) lives in `src/server/ai/semantic.ts`. To register a
dataset, add it there and expose it through a tool in `src/server/ai/tools.ts`.

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
cp .env.example .env.local   # fill SNOWFLAKE_*; set AUTH_MODE=dev to skip login locally
npm install
npm run db:local             # optional: PGlite on :5433 (dev only; set PG_POOL_MAX=1)
npm run dev
```

## Deploying on Coolify

1. Push this repo to GitHub, then in Coolify choose **New Resource → Application → GitHub** with the **Dockerfile** build pack. Port: `3000`.
2. Add a **PostgreSQL** resource in the same project and set `DATABASE_URL` to its internal connection string. Migrations run on boot.
3. Set the environment variables from `.env.example`:
   - `SNOWFLAKE_*`, including `SNOWFLAKE_PAT`. This account's auth policy rejects key-pair auth for `N8N_OPS`.
   - `NEXTAUTH_SECRET` (session signing), `NEXTAUTH_URL` (the public https URL)
   - `ADMIN_USERNAME` and `ADMIN_PASSWORD`: the first admin, created on first start
   - AI Bot: `AI_PROVIDER=snowflake` (uses `SNOWFLAKE_PAT`; the Snowflake role needs Cortex access)
4. The health check is `GET /api/health`, which is already wired into the Dockerfile.

`docker-compose.yml` runs the app together with Postgres, for a single-box or Compose-based deployment.

## Access

Sign in with a username and password. The first admin comes from `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Admins create
everyone else in **Admin → Users & Access**, where they can also reset passwords, change roles, and disable or delete accounts.
Passwords are stored as scrypt hashes, and failed logins are throttled (8 per username per 15 minutes).
Changes to a user take effect within a minute.

- **viewer**: every dashboard, the Action Centre and the AI Bot (read-only).
- **admin**: everything, plus targets (setup, overrides, CSV upload), settings and users.
