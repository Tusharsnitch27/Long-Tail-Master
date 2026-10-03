# Long Tail: handover

This is the single document a new session needs to continue work on **Long Tail**, Snitch's internal operating tool for its long-tail
(non-apparel) categories. It records every decision, data rule, instruction and open item from the build conversation (29–30 Sep 2026).
Where the code and this document disagree, the code wins. Tell the user and update this file.

---

## 1. Context

| | |
|---|---|
| Owner / user | Tushar (tushar@snitch.com), offline retail and category analytics at Snitch |
| Purpose | One tool for leadership, category owners and store teams to run long-tail categories: plan vs actual, channels, stores, products, inventory, actions and an AI analyst |
| Repo | `github.com/Tusharsnitch27/Long-Tail-Master` (branch `main`; local checkout `/Users/tushar/Desktop/Claude/longtail`) |
| Production | Coolify at `https://longtail.snitch-workflow.com` (the user deploys; Claude cannot log in to Coolify) |
| Name history | Long-Tail Ops → Category Mitra → Snitch Udaan → Snitch Longtail → **Long Tail** (current; the SNITCH wordmark appears above it). Do not write "Snitch Long Tail" |
| Latest commit | `fcfcf08` (login collage). Build passes; all 31 pages return 200 locally |

### How the user works (preferences)
- They give requirements in long pasted specs and many short follow-ups during a turn. Every follow-up is binding.
- They want production-grade, "leadership / MBA owner" thinking: actionable, data-backed insights, never generic filler.
- UI should be compact, elegant and "next level". Current theme: **Atelier**, the login page's warm beige editorial look, used across the whole app (1 Oct 2026; replaced Ocean Teal).
- Never infer targets. Never prescribe discounts without business rules. Don't write simplistic "no sales = bad" actions.
- Where data is missing, **prompt in the UI** (DataPrompt) for an upload or configuration. Never leave a silent blank or show "coming soon".
- Say **"Stores"**, never "Offline" ("Offline" in their plan sheet means Stores).
- Sort categories **A→Z** everywhere. Tables with revenue sort by **revenue, highest first**.
- **Column totals show achievement %** wherever targets exist.
- **Every target change needs a confirmation dialog** listing old → new, and is logged.
- Product images must be large and visible (≥44 px in lists, hover preview 240 px) wherever a SKU appears.
- Show the **last-updated timestamps** at the top of every page, and only three of them: Store sales, Online, Inventory.
- Push to GitHub when work is complete, and check that no secrets are in the commit.

---

## 2. Running and deploying

### Local
- Node 22 is at `~/.local/node/bin` (there's no brew or global node). Prefix commands with `export PATH=/Users/tushar/.local/node/bin:$PATH`.
- Scripts: `dev` (port 3000), `build`, `start`, `typecheck` (`tsc --noEmit`), `migrate`, `db:local` (PGlite Postgres stand-in on :5433; requires `PG_POOL_MAX=1`).
- Preview config: `.claude/launch.json` → `longtail-dev` (node + next dev on :3000). In Claude Code use `preview_start longtail-dev`.
- `.env.local` (gitignored): `AUTH_MODE=dev`, `DEV_USERNAME`, `DATABASE_URL` (local PGlite), `PG_POOL_MAX=1`, `SNOWFLAKE_*`. Dev auth signs you in automatically as an admin.
- Type check: `node node_modules/typescript/bin/tsc --noEmit -p .`. Build: `node node_modules/next/dist/bin/next build`.

### Production (Coolify)
- Env vars (names only; values are in the gitignored `.env.coolify`):
  - Runtime: `TZ`, `DATABASE_URL` (Coolify internal Postgres host), `PG_POOL_MAX=8`.
  - Snowflake: `SNOWFLAKE_ACCOUNT / USERNAME / ROLE / WAREHOUSE / DATABASE / SCHEMA / PAT`, `SNOWFLAKE_CACHE_TTL`.
  - Auth: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `SESSION_HOURS` (default and maximum 8; `SESSION_DAYS` is no longer read), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_RESET_PASSWORD`.
  - AI: `AI_PROVIDER=snowflake`, `AI_MODEL=claude-opus-5-5`, `AI_EFFORT=medium`, `AI_QUESTIONS_PER_HOUR`.
- Deploy = the user clicks **Redeploy** in Coolify. Migrations v1–v7 run automatically at startup (`src/instrumentation-node.ts`), followed by the bootstrap admin and a cache prewarm (including the login showcase).
- After the next deploy:
  1. Set `ADMIN_RESET_PASSWORD=false` once logged in.
  2. In Control Centre → Daily split, click **Generate splits for the year**. It has only been run on the local DB.
- **Security:** the Snowflake PAT, private key and passphrase, and the Postgres password were pasted into chat earlier. The user has been advised to **rotate them**. Never print `ADMIN_PASSWORD` or any secret in chat; never commit `.env*`. Before each push, grep the staged diff for the PAT, `ADMIN_PASSWORD` and `NEXTAUTH_SECRET` values.
- Snowflake auth: the account policy **rejects key-pair auth; only the PAT works** (`authenticator: PROGRAMMATIC_ACCESS_TOKEN`). Role `BUSINESS_ANALYST1`.
- Recommended hardening: a read-only Snowflake role limited to the tables in §5, plus Cortex usage.

---

## 3. Architecture and code map

- **Stack:**
  - Next.js 16 (App Router, Turbopack, `proxy.ts` instead of middleware, async `searchParams`), React 19, TypeScript.
  - Tailwind v4 (theme tokens in `src/app/globals.css`), Recharts, TanStack Virtual, zod v4.
  - `pg`, `snowflake-sdk`, `@anthropic-ai/sdk`.
- **Caching:** `src/lib/cache.ts` `cached(key, ttl, fn)` is stale-while-revalidate (max stale 6 h). `sfCached(key, sql, binds, ttl)` keys on **key + binds only**, so bump the key version when SQL changes. Snowflake occasionally stalls (118 s seen), which is why the cache and the startup prewarm exist.
- **Global context:** `src/server/context.ts` `pageContext(searchParams)` returns `{settings, asOf (last complete day, IST), today, filters {cat, cats (A→Z), channel, mp, stores}, period {range, compare, compareLabel}, stores, byCode, byName, user}`. URL params: `cat`, `p` (preset), `from`/`to`, `ch` (all|stores|online|marketplace), `mp`, `store`.
- **Presets:** Today, Yesterday, Current week, Previous week, MTD (default), Last 30, Last 90, Previous month, Custom. `filterScope(path)` in `src/lib/nav.ts` decides which controls each page shows.

| Area | Files |
|---|---|
| Registry, nav, theme | `src/lib/categories.ts`, `src/lib/nav.ts` (`APP_NAME="Long Tail"`), `src/lib/colors.ts`, `src/app/globals.css` (Atelier tokens; see §8a) |
| Data (Snowflake) | `src/server/data/`: `facts.ts` (store × category × day incl. targets), `channels.ts` (Unicommerce), `sku.ts` (horizontal store × SKU), `products.ts` (Product Master merge), `metafields.ts` (+ `getInwards`), `inventory.ts` (store stock), `warehouse.ts`, `stores.ts`, `freshness.ts` |
| Data (Postgres) | `targetBook.ts` (month targets, splits, store targets, change log), `targets.ts` (legacy overrides), `remarks.ts`, `vm.ts`, `futureInwards.ts`, `db/migrations.ts` (v1–v7) |
| Logic | `plan.ts` (targets, projection), `channelData.ts`, `scope.ts` (`loadScope`, `productPerformance`), `analytics.ts`, `actions.ts` (action engine), `executive.ts` (drivers / risks / opportunities), `storeInsights.ts`, `productInsights.ts`, `lab.ts`, `planning.ts`, `splitModel.ts`, `showcase.ts` (login), `rulesDoc.ts` (rule book + tables list) |
| AI | `src/server/ai/`: `provider.ts`, `orchestrator.ts`, `tools.ts`, `prompt.ts`, `semantic.ts`, `resolve.ts`, `answer.ts`, `store.ts`; UI `src/components/ai/Copilot.tsx`, `Views.tsx` |
| UI kit | `src/components/ui/index.tsx` (PageHeader, Section, Kpi with `tone`, KpiGrid up to 8 cols, Tabs, Thumb, ProductCell, DataPrompt, Pill, `achTone`, Meter, Delta, Notice, Empty, Stat); `table/DataTable.tsx` (virtualised; facets, urlState, searchText); `charts/DailyTargetChart.tsx` (bars coloured by achievement + dashed target + same day last week); `SkuTabs.tsx`; `control/*` (MonthTargetGrid, SplitEditor, SplitGenerate, StoreTargetEditor, MetaUpload, ConfirmChanges) |
| Auth | `src/server/auth.ts`, `passwords.ts` (scrypt; username rule `^[a-z0-9._@+-]{3,80}$`, stored lowercase), `src/lib/session.ts` (HS256 JWT cookie `lt_session`), `src/proxy.ts`, `app/api/auth/*` |
| APIs | `/api/control` (month_targets, splits, split_generate, store_targets, meta), `/api/remarks`, `/api/actions/status`, `/api/vm`, `/api/inwards`, `/api/admin/users`, `/api/admin/settings`, `/api/ai/*`, `/api/health`, and dev-only `/api/dev/probe` and `/api/ai/tool-test` (both return 404 in production) |
| Docs | `docs/SNITCH_LONGTAIL.md` (data design), `docs/DATA_MODEL.md` (original source audit), `README.md`, this file |

---

## 4. Scope: categories

The user's categories: **Accessories, Bags, Belts, Perfumes, Shoes (+Footwear, Sandals), Sunglasses**, plus **Trolleys** (Luggage), which they asked for earlier.
Anything related or similar is included. Nothing else may be mixed in, and **Harvey must decline questions about other categories** such as shirts or jeans.

The SKU prefix decides the category, ahead of the master's category field (longest prefix wins):

| Key | Label | Prefixes | Unicommerce category | Stores source | Colour |
|---|---|---|---|---|---|
| accessories | Accessories | 4MAC, 4MCP (caps), 4MSCK (socks), 4MBD, 4MHT, 4MSFC, 4MSFL | Accessories | horizontal | #e08a3c |
| bags | Bags | BP | Bags | horizontal | #c2527a |
| belts | Belts | 4MBL | Belts | horizontal | #7a6a3a |
| perfumes | Perfumes | 4MSFR | Perfumes | DSR + MTD_TARGET | #0e8a96 |
| shoes | Shoes | SH | Shoes, Footwear | DSR + MTD_TARGET | #0b3b44 |
| sunglasses | Sunglasses | SN | Sunglasses | horizontal | #5cc0c7 |
| luggage | Trolleys | 4MTL | TROLLEY, Luggage | horizontal | #6b7fd7 |

All seven are enabled by default (migration v6 sets `enabledCategories`). An admin can toggle them in Control Centre → Rules & data.

---

## 5. Data sources (user-mandated)

| Table | Grain | Used for | Rules and quirks |
|---|---|---|---|
| `LONG_TAIL_DSR_PERFUMES`, `LONG_TAIL_DSR_SHOES` | store × day, **sale days only** | Stores revenue (`SALES` = gross before returns), units, bills, MRP value; store list and attributes (`STORE_NAME`, `STATE`, `CITY`, `CITY_TYPE` METRO/NON_METRO, `LOCATION_TYPE` HS/MALL, normalise 'Hs'→HS, `AM`, `RM`…) | DSR `SALES` matches horizontal `GROSS_SALES` within 0.5%. Inventory columns are empty. Bills exist only for Perfumes and Shoes |
| `MTD_TARGET_PERFUMES`, `MTD_TARGET_SHOES` | store × day incl. future days | Snowflake store targets (store-level views and target phasing) | 121 duplicate rows deduped (max). The user says these are "randomly shared" |
| `UNICOMMERCE_FACT_ITEMS_INTERMEDIATE` | order item (qty 1) | Online = `SHOPIFY`; Marketplace = AJIO, MYNTRA, FLIPKART, AMAZON, **NYKAA** (`NYKAA.COM`, `NYKAA_FASHION` and `NYKAA_SAPL_TAURU` mapped to one NYKAA) | Revenue = Σ `SELLING_PRICE` **including cancelled items** (user decision, 30 Sep). Cancellations are also counted separately. `RETURN_FLAG` is always 0. Amazon has had no long-tail orders since 23 Jul 2026. Franchise, Own Store and B2B channels are **not** counted |
| `HORIZONTAL_SALES_CATEGORIES` | order line (TYPE Store / Shopify / Marketplace; CHANNEL = store name or web/app/MP) | Store sales for **non-DSR categories**, store × SKU sales, the overall validator / fallback | Includes cancellations and NYKAA. Revenue = `GROSS_SALES`. The user calls it "the real validator for overall numbers" |
| `NEW_MEAFIELDS_PRODUCT_PRODUCTS_GRAPH_QL` (Shopify catalogue) | product × variant → SKU group | **Primary source of name, image, MRP / selling price, live date, status** (`src/server/data/shopify.ts`, user-supplied query + `TITLE`) | Other sources only fill gaps; Control Centre edits win over all. SKU group = variant SKU minus the last `-size` part. Cost price is never read |
| `SKU_MASTER_V1` (3 Oct) | SKU group, all categories, daily | **Replaces the Bible as the product master** (restricted to long-tail categories): lifetime / L30 sales, qty, returns by channel incl. OMNI and QCOM, unit COGS (gross profit), inwards, image (images: SKU master first, then the Shopify catalogue) | Category column is upper-case; trousers etc. excluded by the category filter |
| `STORE_FACT_ITEMS_OFFLINE` (3 Oct) | POS line | **Omni** (`DOC_PREFIX = 'OMS'`) and **Qcom** (`'QCOM'`) sales, `ORDER_STATUS = 'Processed'`, excluding `CB%` / `NT%` SKUs | `SELLING_PRICE` is the line total, `MRP` and `COGS_PRICE` per unit. Store sales (DSR / horizontal) = `ARS` docs only, so Omni / Qcom are not double counted |
| `LONG_TAIL_MASTER_BIBLE` | SKU group | Product identity, image, MRP, inwards, lifetime sales / qty / returns by channel → **Return %** (lifetime, value-based) | **1 Oct 2026: the table was rebuilt upstream and holds only 44 Perfumes rows** — lifetime sales / returns / inwards are empty for every other category until it is restored (ask the user). Earlier ~619–647 rows. **No Bags or Sunglasses.** 164 legacy `SH…` rows have a null category (→ Shoes). L30 return columns are unreliable (>100%). The `SALES_L30` fields seem filled for Perfumes only |
| `LONG_TAIL_PRODUCT_INVENTORY_MASTER` | SKU group | Name / colour fallback only | Stale |
| `GS_LONGTAIL_METAFIELD` (singular) | SKU group | `META1` = L1 type, `META2` = L2 sub-type (colour for bags / belts), `IMAGELINK`, `NAME`, `CATEGORY` (incl. Caps, Sandals, Footwear) | The user wrote "gs_longtail_metafields"; that name doesn't exist or isn't authorised. Socks have no images. State of Mind (`4MSFR0944`, "SOM-Gift box") has no image anywhere |
| "Longtail Metafields" workbook (the user's Excel) → `src/data/shoe-metafields.json` | SKU group (140) | Shoe colour, occasion, aesthetic, best with, closure, upper material, sole type, toe shape, construction, season, sole material | **L1 / L2 deliberately NOT taken from it** (user instruction). Sheets: Style-mapping (90), SKU-level (merged 50 more), Logic, Dropdown |
| `OFFLINE_MASTER_DAILY_REPORT_1` | store × SKU group × DATE (~190 M rows; ~140 stores) | **Store inventory: latest DATE = live**, earlier dates = history; `SALES_LAST_7/30_DAYS`; `NEW_CATEGORY`; store category mix across ALL categories (store-size denominator) | `SKU_GROUP` is **lower-case** → upper-case it and map to Product Master codes. `BRANCH_CODE` is a float. `MARKETPLACE_MAPPED` = store name. Size columns are apparel sizes (no shoe sizes) |
| `JIT_OFFLINE_GOODS` | store × size SKU × allocation date, current state (~77K rows, all categories; long tail ≈10.5K units on 1 Oct) | **Goods in transit (GIT)** warehouse → stores (`src/server/data/git.ts`) | `SKU_GROUP` is only the style for shoes (SH0173) → product taken from `ITEM CODE` via `productCode`. Status pipeline: WH_PENDING → PICKUP_PENDING → ESHIP_PENDING → DELIVERY_PENDING → INWARD_PENDING. Status is shown **only** in the Goods in transit tab (user instruction); elsewhere just "In transit" units |
| `UNICOMMERCE_LIVE_INVENTORY` | warehouse × size SKU, current state | Live warehouse stock; `INVENTORY` = good stock | **Only SAPL-WH1, SAPL-WH2 (South) and SAPL-NORTH-TAURU (North)** |
| `SNITCH_FINAL_INVENTORY_WH2` | warehouse × SKU × DATE | Daily warehouse history (the same three facilities) | `INVENTORY` is VARIANT → `try_to_number(to_varchar(...))` |
| `PUTAWAY_TRACKING` (`FINAL_TYPE='New Inward'`) | putaway item | **Only** for the product inward timeline (date, warehouse, qty) and recent inwards | For SH0173-01 it shows 14,193 vs 15,127 in the Bible. The page notes the difference |
| ~~`SPEED_INVENTORY`~~ | — | **Not used** (user instruction) | Only covered ~20 stores; `SKUGROUP` null for new SKUs |
| ~~`INVENTORY_DAILY_SNAPSHOT_LATEST`~~ | — | Not used | Code removed |

Inventory is a snapshot metric: **never sum across days**. **Three phases everywhere: Stores · In transit · Warehouse**; DOI and STR use all three.
**Postgres tables:** `app_users`, `app_settings`, `month_targets`, `remarks.tag` (v8), `day_splits` (+`source`), `store_month_targets`, `target_overrides` / `target_history` (legacy, still applied), `remarks`, `action_status`, `vm_revamps`, `future_inwards`, `product_meta`, `saved_views`, `ai_conversations`, `ai_turns`, `audit_log`, `schema_migrations`.

---

## 6. Metrics and business rules

| Metric | Definition |
|---|---|
| Revenue | **Gross sales before returns.** Stores: DSR `SALES` (Perfumes, Shoes) or horizontal `GROSS_SALES` (other categories); Online = **Normal** (Unicommerce Shopify orders with `WAREHOUSE_NAME` like `SAPL%` only) + **Omni** + **Qcom** (POS lines, see §5); Online / Marketplace: Σ selling price of all items **including cancellations**. Online sub-channels use `mp` = SHOPIFY / OMNI / QCOM (`ONLINE_SUBS`) |
| Overall | Stores + Online + Marketplace (reconciles by construction) |
| Units | DSR qty; Unicommerce items; horizontal quantity. **Free gifts excluded:** any item or line sold under **₹10 per unit** (e.g. socks given free), all categories. Gifts are counted separately (`ChannelDay.gifts`). DSR totals can't separate gifts |
| ASP / AOV / ATV / UPT | revenue ÷ units / ÷ orders / ÷ bills; units ÷ bills (bills for Perfumes and Shoes only) |
| Discount % | 1 − revenue ÷ MRP value sold (gift lines excluded from MRP) |
| Return % | Lifetime returned ₹ ÷ sold ₹ from the Bible, per channel. There are no period returns (Unicommerce has no return flag) |
| Cancellation % | cancelled items ÷ all items (Online / Marketplace) |
| **DOI / days of cover** | (store + **in transit** + warehouse units) ÷ (**last-30-day units** ÷ 30). Red <14 (21 on some lists), amber >180 |
| STR (L30) | L30 units ÷ (L30 units + current store + warehouse stock). Lifetime STR = lifetime sold ÷ inward qty |
| Category live in a store | Stock > 0 on the latest store report, or sales in the last 60 days, and no "not applicable" remark. **Store actions only target live stores**; non-live stores go to distribution / expansion |
| Long-tail penetration | category L30 units ÷ the store's total L30 units across all categories (store report). A stand-in for bill penetration: true bill penetration needs **total store bills**, which aren't available (DataPrompt asks for them) |
| Store size | the store's total L30 units across all categories (store report) |
| Achievement (MTD) | revenue of slices that have a target ÷ phased target to date (like for like) |
| Month-end projection | slices with a target: MTD achievement × month target; others: daily run rate × days. Always labelled "projection" |
| Required run rate | (month target − revenue to date) ÷ days remaining |
| Status bands | Ahead ≥105%, On track ≥95%, At risk ≥80%, Behind below (editable in Settings). Chart bars: green ≥95%, amber 80–95%, red <80% |
| Comparisons | MTD vs previous month same days; weeks vs the same days last week; a single day vs the same weekday last week; L30 vs the prior 30; L90 vs the prior 90 |

### Validation facts (1–29 Sep 2026)
- Horizontal totals: Stores ₹2.155 Cr, Shopify ₹1.72 Cr, Marketplace ₹0.503 Cr, **₹4.38 Cr** in all.
- The tool, after including cancellations and Nykaa: **₹4.47 Cr**.
- By category (horizontal): Shoes ₹2.30 Cr, Perfumes ₹1.35 Cr, Bags ₹17 L, Trolleys ₹16 L, Sunglasses ₹16 L, Belts ₹15 L, Accessories ₹9 L.
- Stores ~₹2.13 Cr (DSR) vs ₹2.155 Cr (horizontal).
- The user had expected more than ₹5 Cr. The gap is franchise and B2B sales in Unicommerce (~₹1 Cr), which they have not asked to include; ask if this comes up again.

---

## 7. Targets (Control Centre, admin only; `/settings`)

- **Month targets** (`month_targets`, channel × category × month, entered in ₹ lakhs):
  - The **FY 26-27 plan (Apr 2026–Mar 2027) was seeded from the user's plan sheet**; FY total 10,143 L (₹101 Cr). Sep = 765.5 L; the user confirmed **Sep overall = ₹7.66 Cr**.
  - Offline → Stores. Trolleys has no targets. Marketplace Bags = 0 from Sep, treated as a **deliberate 0** (not missing).
  - The plan is gross; actuals are gross.
  - UI: FY selector; tabs for Overall / Stores / Online / Marketplace; past months show actual and achievement; upcoming empty cells are flagged "pending"; totals show achievement and YTD %; CSV template / upload (channel, category, month, target_lakhs); confirmation before saving.
- **Stores rule (final, 30 Sep):** the **plan's category target always wins.** There is **no max rule**; an earlier max(plan, Σ store targets) rule was removed at the user's request.
  - Store targets (Snowflake, or uploaded in the Store targets tab) only spread the plan across stores and days, and appear in store-level views.
  - A mismatch of more than 1% is flagged: DataPrompt plus a `target_mismatch` action. Currently Perfumes plan ₹1.15 Cr vs Σ store targets ₹1.75 Cr, and Shoes plan ₹80 L vs ₹1.17 Cr. About ₹16 L of Shoes target sits on 28 stores where Shoes isn't live.
- **Store targets** (`store_month_targets`): store × category × month. When uploaded for a category-month, they replace the Snowflake store targets for store-level views, phased by the state split. CSV columns: branch_code (or store), category, month, target (₹).
- **Daily split** (`day_splits`, per channel, and per state for Stores; `*` = All India):
  - Weights are normalised. With no split the month is phased evenly; for Stores it falls back to the Snowflake store-target shape.
  - The user's reasoning: every month differs by weekday, sale events and salary credit at the start of the month.
  - **"Generate splits for the year"** writes the **actual** daily shape of gross sales for past and current months, and a **recommendation** for Oct onwards.
  - Recommendation = weekday index (last 12 weeks) × day-of-month index (last 6 months, buckets 1–3 / 4–7 / 8–14 / 15–21 / 22–25 / 26–31, shrunk 30%, capped 0.75–1.35) × festive uplift (`EVENTS` in `src/server/splitModel.ts`).
  - Findings: Stores Sunday 1.63×, Saturday 1.34×; Online and Marketplace roughly flat; the salary effect is small (Stores days 1–3 = 1.03).
  - Assumed festive uplifts [Stores, Online, Marketplace]: Gandhi Jayanti 2 Oct; Navratri 11–19 Oct; Dussehra 20 Oct; pre-Diwali 1–5 Nov; Dhanteras / Choti Diwali 6–7 Nov (1.45 / 1.25 / 1.2); Diwali 8 Nov (0.7 / 0.8 / 0.9); Bhai Dooj 10–11 Nov; Black Friday 27–29 Nov; Christmas; New Year's Eve; Republic Day sales 24–26 Jan; Valentine's week 7–14 Feb; Holi 21–22 Mar 2027. **These are assumptions for the user to review.**
  - Custom splits are kept unless "replace custom" is ticked. Sources are shown as actual / recommended / custom / even. "Use recommendation" is available per month. Upload CSV: date, weight_pct.
- **Change log:** every Control Centre write (targets old → new, splits, store targets, attributes, users, remarks, VM, inwards) goes to `audit_log`, shown under Control Centre → Change log.
- Legacy `target_overrides` still apply in facts, but their UI was removed.
- **Saves are verified (1 Oct):** `saveMonthTargets` reads the saved cells back and returns them; the grid shows the database values and warns if any cell didn't save as entered. Two bugs that could make targets look reverted were fixed: a stale-while-revalidate refresh could write pre-save values back into the cache after an invalidate (`src/lib/cache.ts` now only writes back if the entry is unchanged), and failed target reads were cached as "no targets" for 60 s. Locally the audit log showed Trolleys Stores Oct = ₹10 L saved, then cleared a minute later by an explicit blank save; production data wasn't inspected.
- Postgres gotcha: never alias a column as a bare `month` or `day`; use `as month`.

---

## 8. Pages and use cases

The top bar shows filters (category / period / channel as relevant) plus timestamps: **Store sales** (DSR to date), **Online** (latest order item), **Inventory** (warehouse live; the tooltip adds the store report date).

| Page | Use cases / content |
|---|---|
| **Executive Summary** `/` (1 Oct: "Low inventory · top sellers" removed — At-risk SKUs covers it; contribution bars hover for the split; SKU notes carry store · WH stock) | Global category, period and channel filters (default Overall + MTD). **KPIs:** Revenue, Target MTD, Gap, Achievement %, Month-end projection, Projected achievement, Required run rate (days remaining), ASP. **Data prompts:** missing targets and store-target mismatch. **Daily revenue vs target chart:** default last 30 days; switch 7 / 30 / 60 / 90 / MTD / period (`?dr=`). **Channel contribution by category** (stacked bars). **Category comparison:** units, revenue, growth, ASP, discount, share, target, achievement, gap, projection, projected achievement, with a total row. **Drivers, risks, opportunities:** short, 3 each; leadership actions were removed. **Inventory and DOI by category** (store, warehouse, North · South). **Low-inventory top sellers.** **Top 10 / Bottom / At-risk SKUs per category tab**, with image, revenue, units and **current inventory (store · WH) + cover**. In the Overall view, store-only metrics aren't shown |
| **Daily Overview** `/overview` | Day-level table: revenue, target, achievement, gap, status, vs same day last week, units, bills, orders, stores selling, ASP / ATV / UPT, discount, channel and per-category columns, totals with achievement; daily chart; category and channel filters |
| **Ask Harvey** `/harvey` | AI analyst (see §9). The old `/mitra` route redirects here, keeping `?q=` |
| **Category Performance** `/category` | Summary per category (channel contribution — the duplicate per-category bars were removed, product contribution, scorecard incl. top-10 share, SKUs making up 80% of revenue and **Inventory · live: store, warehouse, WH S · N, total, DOI**, inventory: stores vs warehouse split SAPL-WH1 / WH2 / South / North, 60-day inventory trend, watch lists). **Product performance tab:** filters (category, type L1, sub-type L2, colour); **metafield search** ("black shoes" matches colour, type, name, AND words); L7 / vs LW, L30 / vs LM, STR, return %, lifetime sales, inward qty, current inventory; flags |
| **Product Master** `/products` | **Table by default** (`?view=cards` for cards); Team remark column; filter builder (below); filters incl. collection, lifecycle, flag; KPIs; prompts for missing metafields / images |
| **Product detail** `/products/[sku]` | 184 px image, metafield description, 2-line computed summary, attribute grid, KPIs, 60-day units and revenue by channel, channel split incl. marketplaces, **inward timeline (putaway only)**, store distribution sorted by revenue (units, L7, L30, stock, cover), inventory now (Stores / WH South / North), size-level WH stock, 90-day inventory history, action opportunities (reorder to 45 days, transfers, size gaps, returns, trends, North/South mismatch…) |
| **Channel Overview** `/channels` | KPIs (share per channel, omni products, online-vs-stores ASP gap), channel cards removed (the economics table carries the same + active products; its category mix bar hovers for every category's ₹ and %), key insights (computed), channel × category matrix (revenue, growth, achievement), driving vs dragging, economics table |
| **Store Overview** `/stores` | **Summary** (plan KPIs, live-store KPIs, ATV / UPT / bills, penetration, stock-outs, daily chart, key pointers, bands, category scorecard, to-do, top / lowest 10 by achievement, top SKUs in stores). **Stores table** (live) + non-live list. **States & formats** (HS vs Mall, Metro vs Non-metro, state, region, store status, category × format matrix). **Distribution & expansion** (top-25 store coverage matrix, cities with no live store, launch candidates with potential, under-penetrated, stock-out / dead-stock). **DSR** (yesterday vs LW, WTD, L7, MTD, to-do board by type, per-store table, daily detail with totals). **Stores tab filters** (1 Oct): Category, Type, Sub-type, Colour (`mf_l1`, `mf_l2`, `mf_colour`) add "Matching" columns per store (revenue, share, units, stock, cover, SKUs). **Goods in transit** tab (`?tab=git`, `GitTab.tsx`): KPIs, pipeline by status, ageing buckets, by category, by store (per-status columns), line detail with store stock / L30 / cover and flags (stuck ≥7 d, store holds it without selling = redirect candidate). **Store filter bar** under the tabs (`StoreOverviewFilters`): Store, Region, State, City, Format, City type, Model, Status, Area manager (`store`, `s_region`, `s_state`, `s_city`, `s_fmt`, `s_ctype`, `s_om`, `s_status`, `s_am`); attribute filters resolve to branch codes server-side and also apply to the network tabs, individual store picks don't. **Store × product** tab (`?tab=products`, `src/server/storeProducts.ts`): every SKU at store level with image, period / L7 / L30 units, store stock and cover, share of the store's category; plus a store × metafield heat map (Type, Sub-type, Colour, Occasion …; revenue / units / stock / share) |
| **Store detail** `/stores/[code]` | Peer-benchmarked KPIs, category table (live / stock-out / dead / low cover), trend, top sellers, low stock, stocked-not-selling, network best sellers missing, actions |
| **Online** `/online`, **Marketplace** `/marketplace` | ("Top products" and "Inventory availability" removed as duplicates of Top 10 SKUs / Warehouse inventory) Channel KPIs vs target (target, achievement, projection, required per day, orders · AOV, ASP · discount, cancellations · returns), daily chart vs target, marketplace comparison and selector, **warehouse inventory by category North / South with cover**, out-of-warehouse sellers, top 10 per category, high-return products, listing gaps (marketplace), product table |
| **Merchandising** `/merchandising` (nav: moved to "In the works", WIP badge) | Inventory position, allocation (21 days of cover, capped at 25% of warehouse), distribution vs comparable strong stores, excess |
| **Action Centre** `/actions` | Summary strip, filters, cards (why / evidence / recommendation / impact / confidence), Done / Snooze / Dismiss, **Add remark** with suggestion chips and examples, Team remarks tab (§10) |
| **VM Revamp** `/vm`, `/vm/[id]` | Pipeline Shortlisted → Approved → Design/planogram → Fixtures & stock → Execution → Live → Review; status, owner, target date, overdue; notes trail; before / after 28-day performance vs peers (lift, incremental ₹/month); suggested candidates |
| **Admin Lab** `/lab` (admin) | "Rough canvas" of 13 experimental views: category health score, path to ₹100 Cr (run rate ~₹50 Cr, needs 2×), Pareto, price bands / ASP, new launches, size gaps, store × category heatmap, dead-stock ageing, channel-mix shift, return leakage, marketplace gaps, cannibalisation, turns / GMROI; plus an ideas list |
| **Demand Planning** `/planning` (WIP) | DOI band (`lo` / `hi`), lead time, forecast (weighted L7 / L30 × damped trend), reorder = max(0, rate × (lead + target DOI) − stock − open inwards), open-to-buy (OTB) next month (plan target where set) |
| **Future Inwards** `/inwards` (WIP) | New / repeat designs pipeline (form + CSV), cover after inward, benchmarks, actual recent putaways |
| **Ads Spend & Insight** `/ads` | "Planned for future" placeholder; asks for the ads spend source table |
| **Control Centre** `/settings` (admin) | Month targets · Daily split · Store targets · **Products** (product editor: search / gaps / edited filters, edit name, image, type, sub-type, colour, collection, material and category attributes, reset to source; coverage; CSV upload) · Users & access · Rules & data (rule book with where it applies and its value; tables used; freshness; thresholds form) · Change log |
| **Login** `/login` | Beige editorial collage, no scroll on desktop:<br>• Banner "Welcome to *Long Tail*" (SNITCH wordmark above).<br>• **Footwear:** hero boot + small images per shoe type (sneaker, mules, loafer, sandals).<br>• **Fragrance:** top perfume + 2 more + the State of Mind gift-set tile.<br>• **Bags · Belts · Socks:** a cap shows because socks have no image.<br>• **Luggage:** Vitto and Rubik under the sign-in box (top right).<br>• Only perfumes carry names; **no sunglasses**; no channel or store figures on this public page.<br>• Chosen automatically by L30 gross sales; cached 6 h and warmed at startup (`src/server/showcase.ts`) |

### 8a. Theme: Atelier (from the login page)
- Tokens in `src/app/globals.css`: bronze accent scale `brand-50…900` (500 = `#a8703f`, 900 = espresso `#1b1712`); `zinc-*` is overridden
  with warm stone so every neutral utility follows the theme; `canvas #f3ebe1`, `paper #fbf7f1` (cards), `line #e6dbcc`, `ink #1b1712`, `side` espresso.
- Fonts via `next/font` (self-hosted at build): Inter (`font-sans`) for UI and numbers, **Playfair Display** (`font-serif`) for page titles,
  section titles, the sidebar wordmark and Harvey. Small labels use wide-tracked uppercase (`.eyebrow`, KPI labels).
- Solid buttons and selected tabs are espresso (`bg-brand-900`); the app background is `.atelier` (the login's soft warm light).
- **Polish primitives (globals.css):** `.card` (paper gradient + gradient hairline border + layered shadow; used by Section, Kpi, DataTable, ActionCard, editors), `.card-lift` (hover lift), `.sheen` (hover light sweep on KPIs), `.gold-rule` (section header divider), `.ornament` (bronze diamond before section titles), `.text-gilded` / `.text-gilded-light` (animated bronze text: wordmark, "Harvey"), `.stagger` (staggered entrance of page blocks and KPI grids), grain texture in `.atelier`. Every `bg-brand-900` surface gets an espresso gradient with a top highlight (unlayered rule — it deliberately sets only `background-image`, never `box-shadow`, so rings and shadows survive). Charts: gradient bar fills and the shared espresso tooltip in `src/components/charts/theme.ts`. All motion is off under `prefers-reduced-motion`.
- Chart colours: channels are one bronze scale (`CH_COLORS`); WH South caramel, WH North deep teal `#2e6f73`; category colours re-tuned to earthy hues.
  Green / amber / red still carry status meaning only.

**Shared UI (1 Oct):**
- Every chart has a **CSV** button with the data behind it (`src/components/charts/ChartDownload.tsx`; built into TrendChart, DailyTargetChart, ExecTrend, Harvey charts; Section `right` slot for CSS charts). Product page Units + Revenue charts merged into one with a switch (`SwitchTrend`).
- `MixBar` (`src/components/ui/MixBar.tsx`): stacked share bar with a viewport-positioned hover popover (never clipped by scrolling tables).
- DataTable: **Add filter** rule builder (column · operator · value, AND; `₹` values accept 50k / 1.5L / 2Cr; % columns take percent), visible Sort-by control, labelled facet pills that turn espresso when active, rule state in `?f=` (`key~op~value|…`). Thumbnails default to 44 px.
- Filters / editable fields are deliberately loud: global filter bar has labelled controls (CATEGORY / PERIOD / CHANNEL), white controls on a tinted bar; target-grid cells are white boxed inputs, bronze when changed.

Logout: a button next to the user's name at the bottom of the sidebar, and also in its menu.

---

## 9. Harvey (AI) — formerly Mitra

- Claude `claude-opus-5-5` via **Snowflake Cortex's Anthropic-compatible endpoint** (`/api/v2/cortex/v1/messages`, PAT auth; the user has no Anthropic API key). Adaptive thinking, effort `medium`, streaming.
- Cortex rejects `strict` tools and `fallbacks`, so those are used only when `AI_PROVIDER=anthropic`.
- **Governed tools only, no free SQL:**
  - `resolve_product`, `resolve_location`
  - `get_performance`, `get_channel_performance`, `get_sku_performance`
  - `get_current_inventory` (store report + warehouse North / South)
  - `get_product_summary`, `get_actions` (with team notes), `get_team_remarks`
  - `get_exceptions`, `explain_change`, `submit_answer` (views hydrated server-side)
- **Scope guard** in the prompt and resolvers: out-of-scope categories are declined (tested: "shirts and jeans" declined in ~9 s).
- The prompt covers: gross revenue, free-gift and DOI rules, the live rule, the plan-wins target rule, remarks, and "chart / table / X vs Y" requests.
- Answers take ~20–90 s (the Stryker allocation took 79 s). `AI_EFFORT=low` is faster.
- Renamed Mitra → **Harvey** on 1 Oct 2026; the nav item and CTAs read **"Ask Harvey"**. The page has a hero intro ("I'm Harvey, your Long Tail analyst…"), grouped suggested questions (Quick answers · Compare · Explain · Act), live tool progress, a Stop button, copy and follow-ups. `?q=` prefills the question.
- Earlier question from the user: Harvey only sees the tables its tools query. To enforce this at Snowflake level, create a read-only role limited to those tables and issue a PAT for it.

---

## 10. Actions and remarks

- **Engine:** `src/server/actions.ts`, cache key `actions:v10` plus a remarks signature.
- **Marketing group (1 Oct, tab in the Action Centre):** one boost per product — *New inward — launch push* (inward ≥50 units in 30 days, WH ≥30, ≥45 days of cover at the L7 pace), *Paced down, stock available* (L30 ≤75% of prior 30, prior ≥30, stock ≥ a month at the earlier pace), *Online inventory to push* (online + marketplace L30 ≥5 units, WH ≥50, ≥60 days online cover). Recommendations are visibility (site, ads, CRM, marketplace, VM) — never a discount. Cache key `actions:v12`.
- **GIT double-check (1 Oct):** allocation nets in-transit units to that store (skips if covered), missed distribution skips stores with it on the way, store restock / replenish to-dos count GIT, product opportunities count GIT; new `git_stuck` action per store (≥5 units pending ≥10 days). Cache key `actions:v13`.
- **Product tags** (`src/lib/productTags.ts`, `remarks.tag`): Not to be sent to stores · Being called back from stores · Online only · Discontinued · Quality hold · Don't promote. Added on the product page (Team remarks panel); each hides the action types it contradicts for that SKU and shows as a note elsewhere; Harvey sees them. The action-card remark form was **kept as before** (the user preferred it to a simplified version).
- **Action types:** channel decline, mix shift, return risk, target recovery, category gap, inventory low sales, fast mover low cover, slow moving, distribution, missed distribution, declining, allocation, **target not live**, **expansion candidate**, **target mismatch**.
- **Rules:** `RULES` constant (listed in the Rules & data tab). Gift products are never flagged. Warehouse zone is suggested on allocations.
- **Remarks** (`remarks` table; any signed-in user can add one; the author or an admin can deactivate it):
  - **Kinds:** not applicable, snooze (until a date), context.
  - **Scopes:** action, store, store × category, product, category, date, general.
  - **Examples from the user:** "Hilite store has no perfumes" (not applicable, store × category → the category is treated as not live) and "10× perfume sales that day was the Snitch birthday" (date context → excluded from week-on-week baselines and short-window comparisons, and shown as a team note).
  - Hidden actions are listed under "Hidden by remarks" with Unhide.

---

## 10b. Access control (3 Oct)

- Roles (`src/lib/access.ts`): **superadmin** (only role that can download; = admin whose username is in `SUPERADMIN_USERNAMES`, default `ADMIN_USERNAME`; never assignable in the UI), **admin** (no downloads), **viewer**, **store_actions** (store pages + actions; no ₹ revenue / GP), **online_actions** (Online, Marketplace, Qcom, actions; no store pages), **designer** (products, categories, actions; no ₹ / GP). Migration v9 widens the role check.
- Enforcement: page access in `pageContext` (redirect to `/no-access`) and the app shell; nav filtered by `canOpen`. ₹ masking: server formatting through `inr` reads a per-request React-cache flag (`lib/mask.ts`, set by `applyAccess`); client components read `useAccess()` (DataTable drops ₹/GP columns, ₹ charts show a placeholder, SkuTabs show units); pre-formatted action / to-do text is scrubbed (`scrubMoney`). Harvey is off for store_actions / online_actions / designer (page + API).
- Downloads: every CSV button checks `useCanDownload()` (super admin only); exports include SKU group, item code, city, image URL and hidden columns.
- No table / source names are shown anywhere in the UI (the Control Centre tables list and source freshness list were removed).

## 11. Auth and users

- Username + password only (the user rejected Cloudflare Access and Google SSO). Roles: **admin** (Control Centre, Admin Lab, user management) and **viewer**.
- Usernames: 3–80 characters of letters, digits, `. _ - @ +` (email addresses work; stored lowercase; no spaces). Passwords are scrypt-hashed.
- **Sessions expire 8 hours after sign-in** (hard cap, `SESSION_HOURS` can only shorten it; `SESSION_DAYS` is ignored). The proxy sends an expired cookie to `/login?error=session`; `SessionTimer` redirects an open tab at expiry.
- Login throttle: 8 failures per 15 min. The bootstrap admin comes from `ADMIN_USERNAME` / `ADMIN_PASSWORD`; `ADMIN_RESET_PASSWORD=true` forces a reset on boot.
- Redirects are relative (the app runs behind a proxy). If the DB is down, users fall back to the viewer role.

---

## 12. Development gotchas

- In zsh, a variable named `path` clobbers `PATH`. Use another name in loops. Filenames containing `(app)` break unquoted `for f in $files` loops; use `while IFS= read -r f`.
- Turbopack: keep Node-only imports out of `instrumentation.ts` (use `instrumentation-node.ts`).
- `sfCached` keys don't include the SQL, so bump versions (`uc:day:v3`, `uc:sku:v3`, `skufacts:v2`, `facts:raw:v2`, `products:merged:v3`, `login:showcase:v6`…). After a DB migration, restart dev to apply it.
- The Browser pane is shared with the user; they may navigate it. Viewport emulation renders oddly in the pane, so check wide layouts with a separate tab or curl.
- Python helper for ad-hoc Snowflake queries: `scratchpad/sf.py` (reads `.env.local`, PAT auth, statements separated by `;;`). It lives in the session scratchpad; recreate it if missing.
- A dev probe exists: `/api/dev/probe?what=products|warehouse|channels|targets|sku&q=`.

---

## 13. Open items and suggested next steps

**Open decisions / data asks**
- Cut size % for shoes (pivot sizes 8 / 9 / 10): store shoe stock by size exists only in `LOGIC_FINAL_INVENTORY` (EU sizes 39–45); waiting for the user to confirm the UK→EU mapping and rule (any vs all pivot sizes missing) and whether that table may be used.
- Qcom inventory: the godown carrying Qcom stock isn't in the sources in use; Qcom views show sales only until it is named.
0. `LONG_TAIL_MASTER_BIBLE` now has Perfumes only (rebuilt 1 Oct) — lifetime sales, return %, inward qty and lifetime STR are blank for other categories until it is restored.
1. Franchise and B2B sales (~₹1 Cr in Sep) are not counted. Confirm with the user whether their targets include them.
2. Total store bills are needed for true bill penetration. Return date and reason are needed for period returns.
3. Socks and State of Mind images: add them via Control Centre → Product attributes (`image` column).
4. Trolley targets are missing from the plan.
5. Review the festive uplift assumptions and the recommended splits for Oct–Mar. Run **Generate splits** in production.
6. Align store targets with the plan for Perfumes and Shoes; re-allocate the ~₹16 L of Shoes target sitting on non-live stores.
7. Rotate the Snowflake PAT, private key and passphrase, and the Postgres password (they were shared in chat). Set `ADMIN_RESET_PASSWORD=false`.
8. Remark deletion is currently limited to the author or an admin. Confirm with the user.

**Roadmap ideas already proposed** (not built):
- festive / event calendar feeding splits and anomalies;
- weekly store push lists for area managers (email / WhatsApp);
- store distribution planner;
- size-curve buying;
- price and discount effectiveness;
- scheduled reports (daily 10 am summary, weekly PDF);
- target history and forecast-accuracy tracking;
- promoting Admin Lab views (path to ₹100 Cr, dead-stock ageing) to main pages;
- Ads page once spend data exists;
- demand planning with open purchase orders and lead times.

---

## 14. Version history (commits)

| Commit | Summary |
|---|---|
| `46fb695` | Long-Tail Ops v1: perfumes and shoes performance, targets, SKUs |
| `9a1b80e` → `06513f0` | Cloudflare Access → Google sign-in → username/password; AI Copilot |
| `5c03703` | Claude via Snowflake Cortex |
| `6484a49` | Admin reset switch, config warnings |
| `1e83e58` | Category Mitra v2 (channels, executive plan, actions) |
| `ef25baf` | Snitch Udaan v2: Ocean Teal, Control Centre targets, new sources, all categories, 4 parallel page builds |
| `2783504` | Email-style usernames |
| `239829f` | Rename; product-wall login; split actuals + recommendations |
| `fdee4e7` → `fcfcf08` | Login collage iterations; name **Long Tail** |
| (3 Oct) | SKU_MASTER_V1 product master; category views (Overall + Stores / Online normal / Omni / Qcom / Marketplace, GP %, DOI 30D, targets) on Executive Summary and Category Performance; Online = Normal · Omni · Qcom; Qcom page; roles & access; super-admin-only downloads; source names removed from the UI |
| (1 Oct, 4th) | Goods in transit (JIT_OFFLINE_GOODS) as the third inventory phase everywhere + GIT tab + action double-check; Store Overview filter bar (region, state, city, format, …) |
| (1 Oct, 2nd) | 8-hour sessions, chart CSV downloads, MixBar hovers, duplicate charts removed, scorecard inventory, Marketing actions, product tags, Shopify catalogue, Control Centre product editor, Store × product tab, Stores metafield filters, table filter builder, target-save verification + cache race fix |
| (1 Oct) | Mitra renamed **Harvey** ("Ask Harvey", `/harvey`); Atelier theme across the app |

When continuing, start by reading this file, `docs/SNITCH_LONGTAIL.md` and `src/server/rulesDoc.ts`, then run the type check and build to confirm a clean baseline.
