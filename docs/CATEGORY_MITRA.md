# Category Mitra: data design (first deliverable)

Validated against Snowflake `SNITCH_DB.MAPLEMONK` on 29 Sep 2026. Every number below was queried, not assumed.

## A. Source mapping

| Source | Grain (validated) | Date / time | Keys | Used for | Limitations |
|---|---|---|---|---|---|
| `LONG_TAIL_DSR_PERFUMES`, `LONG_TAIL_DSR_SHOES` | store × day. **Rows exist only on days with a sale** | `DATE` (IST); today is partial | `BRANCH_CODE`, `STORE_NAME` | Stores-channel revenue, units, bills; DSR view | Net of discount. Inventory columns (`INV_*`) are empty |
| `MTD_TARGET_PERFUMES`, `MTD_TARGET_SHOES` | store × day, every day incl. future days | `DATE` | `BRANCH_CODE` | Store targets (+ Postgres overrides) | 121 duplicate rows deduped. **Targets exist for Stores only** |
| `UNICOMMERCE_FACT_ITEMS_INTERMEDIATE` | **one row per order item** (quantity always 1) | `ORDER_DATE` (latency ≈ same day) | `ORDER_ID`, `SALEORDERITEMCODE`, `SKU`, `SKU_GROUP` | Online (Shopify) + Marketplace revenue, units, orders | `RETURN_FLAG` is always 0; `SALES_TARGET` is empty. **Amazon has no long-tail orders since 23 Jul 2026** |
| `HORIZONTAL_SALES_CATEGORIES` | order line | `DATE` | `SKU_GROUP`, `CHANNEL` | **Store × SKU** sales only | Includes cancelled orders and NYKAA, so it is **not** used for channel totals |
| `LONG_TAIL_MASTER_BIBLE` → **Product Master** | SKU group (647; all long-tail categories since the 29 Sep refresh) | refreshed daily | `SKU_GROUP` | Product identity, image, MRP, inwards, lifetime sales by channel, **Return %**, store inventory | 193 legacy `SH…` rows have no category (→ Shoes); 9 `4MTL…` rows (→ Luggage). The L30 return columns are unreliable (values > 100%) and are not used |
| `UNICOMMERCE_LIVE_INVENTORY` | **current state**: one row per warehouse × size-level SKU (3 warehouses) | `UPDATED` = per-row last change | `FACILITY`, `Item SkuCode` | Warehouse inventory | `INVENTORY` = good stock; blocked, bad and not-synced units are excluded |
| `SPEED_INVENTORY` | store × SKU size × bin × daily snapshot | `SAVED_DATE` per store | `BRANCH_CODE`, `SKUGROUP` | Store-level stock for store detail and allocation | **Only ~20 of ~137 stores are in the feed** |

## B. Metric dictionary (one source per metric)

| Metric | Definition | Source |
|---|---|---|
| Revenue (Stores) | Σ DSR `SALES` (net of discount) | DSR |
| Revenue (Online) | Σ `SELLING_PRICE` of non-cancelled items where `MARKETPLACE_MAPPED = 'SHOPIFY'` | Unicommerce |
| Revenue (Marketplace) | Same, for `AJIO`, `MYNTRA`, `FLIPKART`, `AMAZON` | Unicommerce |
| Revenue (Overall) | Stores + Online + Marketplace, so it reconciles to the channels by construction | derived |
| Units | Stores: Σ DSR `QTY`. Online/Marketplace: count of non-cancelled items | DSR / Unicommerce |
| Orders | Online/Marketplace: distinct `ORDER_ID` (non-cancelled). Stores: bills | Unicommerce / DSR |
| ASP | Revenue ÷ Units | derived |
| Return % | **Lifetime, value-based**: returns ₹ ÷ sales ₹, per channel (`RETURN_PCT_TD_ALL / _OFFLINE / _SHOPIFY / _MARKETPLACE`). At category or channel level: Σ returns ₹ ÷ Σ sales ₹ | Product Master |
| Target / Achievement | Phased store targets; Achievement = Stores revenue ÷ target. Online and Marketplace have no targets | Target tables |
| Growth | Revenue vs the comparable period (MTD vs previous month same days; WTD vs last week same weekdays; day vs same weekday last week) | derived |
| Stores selling | Distinct stores with ≥ 1 sale in the period | DSR |
| Sales / store / day | Stores revenue ÷ (active stores × days) | derived |
| Active SKUs | Products with ≥ 1 unit sold in the period, in the selected channel | Unicommerce + horizontal |
| Store inventory | Product: `OFFLINE_INV_ALL` (all stores). Store: latest `SAVED_DATE` per store in the feed | Product Master / SPEED |
| Warehouse inventory | Σ `INVENTORY` in the live table (current state, never summed over time) | Unicommerce live |
| Days of inventory | (store + warehouse units) ÷ (L30 units ÷ 30) | derived |

## C. Product grain

`Style` (SH0173) → **`Product` = SKU group** (SH0173-01, Classic Chelsea Boots, black) → `SKU` = size (SH0173-01-42).
Everything in Category Mitra is at **Product** (SKU group) level. Sizes appear only in size splits. Warehouse SKU codes map to
products by removing the size suffix (`SH0173-01-42` → `SH0173-01`; perfumes like `4MSFR0916` are already products).

## D. Channel mapping (verified 1–28 Sep, Perfumes + Shoes)

| UI | Source values | Sep revenue (non-cancelled) |
|---|---|---|
| Stores | DSR | ₹1.60 Cr |
| Online | `SHOPIFY` | ₹1.28 Cr |
| Marketplace | `MYNTRA`, `FLIPKART`, `AJIO` (+ `AMAZON` when present) | ₹31.7 L |

Category mapping: Shoes = `Shoes` + `Footwear` (Unicommerce), `SHOES` + `SH…` with no category (Product Master). Luggage = `TROLLEY` + `4MTL…`.
Filter options (categories, marketplaces, stores) are built from the values present in the data. Amazon only appears once it has sales.

## E. Inventory logic

- **Warehouse**: the live table is already the current state (one row per warehouse × SKU), so the latest state is the table itself. It is summed across warehouses and sizes. The "as of" time is the most recent `UPDATED`.
- **Store (per store)**: `max(SAVED_DATE)` per `BRANCH_CODE` within 14 days, then summed across bins and sizes. Stores can have different dates.
- **Store (per product, all stores)**: Product Master `OFFLINE_INV_ALL` (refreshed daily).
- Allocation uses store stock + L7 sales velocity + warehouse stock. It can only run for the ~20 feed stores, and it says so.

## F. Information architecture (built)

| Page | Question it answers | Contents |
|---|---|---|
| **Executive Summary** `/` | Are we on plan? What needs leadership attention? | Status (rules-based), KPIs, MTD progress (time vs target), required run rate, month-end projection, cumulative trend (revenue / units / achievement vs last month and target pace), channel and category tables, contribution, drivers, risks, opportunities, ≤5 leadership actions. In-page channel control: Overall / Stores / Online / Marketplace |
| **Overview** `/overview` | What is happening right now? | Revenue, units, ASP, active products, store and warehouse inventory, trend, channel and category mix, top stores, top products, key alerts |
| **Mitra** `/mitra` | The question I have right now | Governed tools only; same metric definitions as the pages |
| **Category Overview** `/category` | Which categories and products drive performance? | Summary · Product performance · Product Master (+ product detail `/products/[sku]`) |
| **Channel Overview** `/channels` | Which channel drives or drags the result? | Channel cards, driving vs dragging, economics table (target, projection or "Channel target not configured") |
| **Store Overview** `/stores` | Which stores perform; where is execution weak? | Summary (bands, leaders, risks, opportunities) · Stores · DSR (+ store detail) |
| **Online Overview** `/online` | How is Shopify performing? | KPIs, trend, categories, top / high-return products, inventory availability, product table |
| **Marketplace Overview** `/marketplace` | How are marketplaces doing, together and individually? | Marketplace comparison, selector (data-driven), risks, listing opportunities, products |
| **Merchandising Overview** `/merchandising` | Is inventory in the right place? | Inventory position · Allocation · Distribution (vs comparable strong stores) · Excess inventory |
| **Action Centre** `/actions` | What should the team do now? | Urgent · Channel · Stores · SKU · Merchandising, with status tracking |

### Targets
- Stores: Snowflake phased targets plus overrides.
- Online and Marketplace: **admins enter month targets in Settings → Targets → Channel targets**. Until then they show "Target not configured", and nothing is inferred.
- Overall: sums only the channels that have a target, and every target metric names those channels (e.g. "Achievement · Stores").

### Performance
Snowflake occasionally stalls a query (one Unicommerce query took 118 s instead of 0.7 s during testing). The cache is
stale-while-revalidate: after the TTL, the last good result is served instantly while one background refresh runs. Common
queries are warmed at server start.

## G. Wireframes (initial proposal)


```
┌ sidebar ┐┌──────────────────────────────────────────────────────────────────┐
│ Category ││ Category [Overall ▾]  Period [Today|Week|MTD|L30|…]  Channel [All|Stores|Online|Mkt] │
│  Mitra   ││                                   Sales 4:05 PM · Inventory 4:18 PM │
│ Overview ││ Revenue   Units   Target*   Achv   Growth   ASP   Stores   SKUs   Inv │
│ Perform. ││ ───────────────────────── trend (by channel) ─────────────────────── │
│ Stores   ││ Channel: Stores │ Online │ Marketplace        Category: Perfumes │ Shoes │
│ Channels ││ What needs attention: 3–5 actions with evidence and impact           │
│ Products │└──────────────────────────────────────────────────────────────────┘
│ Actions  │  Stores: one table → click opens store detail (mix, top/low products with images, allocation)
│ Mitra    │  Channels: Stores | Online | Marketplace [All|AJIO|MYNTRA|FLIPKART]
│ ──────── │  Products: Product Master (image, identity, lifetime) | Product Performance (period)
│ Settings │  Actions: Urgent · Channel · Stores · SKU · Merchandising (priority, impact, confidence, reason)
│ Profile  │  Mitra: ask anything; answers with KPI / table / chart / allocation views
└──────────┘
```
