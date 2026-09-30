# Snitch Long Tail: data design

"Building the next ₹100 Cr business". This is the operating tool for Snitch's long-tail categories. Sources were validated against
Snowflake `SNITCH_DB.MAPLEMONK` on 30 Sep 2026.

## Scope

The tool covers Accessories (incl. Caps), Bags, Belts, Perfumes, Shoes (incl. Footwear and Sandals), Sunglasses and Trolleys (Luggage).
Nothing outside these categories is shown, and Mitra declines questions about other categories. The registry lives in
`src/lib/categories.ts`: source names, SKU prefixes and colours.

| Category | Stores sales | Online / Marketplace | SKU prefixes |
|---|---|---|---|
| Perfumes | `LONG_TAIL_DSR_PERFUMES` (gross sales, bills) | Unicommerce `Perfumes` | 4MSFR |
| Shoes | `LONG_TAIL_DSR_SHOES` (gross sales, bills) | Unicommerce `Shoes`, `Footwear` | SH |
| Accessories | `HORIZONTAL_SALES_CATEGORIES` (Store lines) | `Accessories` | 4MAC, 4MCP, 4MSCK, 4MBD, 4MHT, 4MSFC, 4MSFL |
| Bags | horizontal | `Bags` | BP |
| Belts | horizontal | `Belts` | 4MBL |
| Sunglasses | horizontal | `Sunglasses` | SN |
| Trolleys | horizontal (`Luggage`) | `TROLLEY` | 4MTL |

Categories without a DSR have no bills and no Snowflake store targets. The UI prompts for store targets to be uploaded instead.

## Source map

| Table | Grain | Used for |
|---|---|---|
| `LONG_TAIL_DSR_PERFUMES`, `LONG_TAIL_DSR_SHOES` | store × day (sale days only) | Stores revenue, units, bills; store list and attributes |
| `MTD_TARGET_PERFUMES`, `MTD_TARGET_SHOES` | store × day | Snowflake store targets, used when no store targets are uploaded for the month |
| `UNICOMMERCE_FACT_ITEMS_INTERMEDIATE` | order item | Online (SHOPIFY) and Marketplace (AJIO, MYNTRA, FLIPKART, AMAZON, NYKAA = Nykaa.com + Nykaa Fashion + Nykaa Tauru): revenue = selling price of items incl. cancellations; cancellations |
| `HORIZONTAL_SALES_CATEGORIES` | order line | Store sales for non-DSR categories; store × product sales; fallback checks |
| `LONG_TAIL_MASTER_BIBLE` | SKU group | Product identity, image, MRP, inwards, lifetime sales by channel, **Return %** (lifetime, value-based) |
| `GS_LONGTAIL_METAFIELD` | SKU group | L1 / L2 (type / sub-type), image, name |
| Longtail Metafields workbook → `src/data/shoe-metafields.json` | SKU group | Shoe colour, occasion, aesthetic, best-with, closure, upper, sole, toe, construction, season, sole material (L1 / L2 not taken from it) |
| `OFFLINE_MASTER_DAILY_REPORT_1` | store × SKU group × day | **Store inventory**: the latest date is live stock; earlier dates are history. Also each store's category mix across all categories (store-size denominator). About 140 stores |
| `UNICOMMERCE_LIVE_INVENTORY` | warehouse × size SKU (current) | Live warehouse stock. SAPL-WH1 and SAPL-WH2 = South; SAPL-NORTH-TAURU = North; no other facilities |
| `SNITCH_FINAL_INVENTORY_WH2` | warehouse × SKU × day | Daily warehouse history (same three warehouses) |
| `PUTAWAY_TRACKING` (`FINAL_TYPE = 'New Inward'`) | putaway item | Product inward timeline only |

`SPEED_INVENTORY` is no longer used. Inventory is a snapshot metric and is never summed across days.

PostgreSQL (app) holds users, `month_targets`, `day_splits`, `store_month_targets`, `remarks`, `action_status`, `vm_revamps`,
`future_inwards`, `product_meta` (attribute edits) and `audit_log` (the change log).

## Targets

- **Month targets** are set per channel × category × month in the Control Centre (in ₹ lakhs). The FY 26-27 plan was seeded from the
  business-plan sheet; "Offline" in that sheet is Stores.
- **Daily split**: weights per day for each channel, and per state for Stores (All India is the default). With no split, the month is phased evenly.
  "Generate splits for the year" (Control Centre → Daily split) fills past months with the **actual** daily shape of gross sales and upcoming
  months with a **recommendation**: weekday index (last 12 weeks) × day-of-month index (last 6 months; salary-credit days, month-end dip) ×
  festive / sale uplifts (`src/server/splitModel.ts`, stated assumptions). Custom splits are kept unless "replace custom" is ticked; everything stays editable.
- **Store targets**: store × category × month, uploaded or edited in the tool. When any store has one for a category-month, the uploaded
  targets replace the Snowflake store targets for store-level views, phased with the Stores split for the store's state.
- **Stores rule**: the plan's category target is the Stores target. Store targets only spread it across stores and days (when no daily split is set); if they don't add up to the plan, the difference is flagged.
- A target of 0 is a deliberate 0. A missing target is never inferred; slices without a target are named and excluded, so achievement is like for like.
- The plan and the actuals are both gross sales (before returns): DSR `SALES` matches `HORIZONTAL_SALES_CATEGORIES.GROSS_SALES` within 0.5%, and Unicommerce selling price reconciles to it within 1–5%.
- Every Control Centre change is written to the change log (old → new).

## Metric dictionary

| Metric | Definition |
|---|---|
| Revenue | Stores: DSR `SALES` (or horizontal gross sales for non-DSR categories); Online / Marketplace: Σ selling price of items incl. cancellations |
| Overall | Stores + Online + Marketplace |
| Achievement (MTD) | Revenue of target slices ÷ phased target to date |
| Month-end projection | Target slices: MTD achievement × month target. Others: daily run rate × days |
| Required run rate | (Month target − revenue to date) ÷ days remaining |
| ASP / AOV / ATV / UPT | Revenue ÷ units / ÷ orders / ÷ bills; units ÷ bills |
| Discount | 1 − revenue ÷ MRP value sold |
| Return % | Lifetime returned ₹ ÷ sold ₹ (Product Master), by channel |
| Days of cover | (store + warehouse units) ÷ (L30 units ÷ 30) |
| Category live in a store | Stock > 0 on the latest store report, or sales in the last 60 days. Store actions target live stores only |

Rules and their current values are listed under Control Centre → Rules & data.

## Pages

| Page | Question |
|---|---|
| Executive Summary `/` | Are we on plan? Revenue, target, gap, achievement, projection, run rate, ASP; daily revenue vs target; category comparison; channel contribution by category; drivers, risks, opportunities; inventory and cover by category; top / bottom / at-risk SKUs per category |
| Daily Overview | Day by day: revenue, target, achievement, gap, status, vs same day last week, units, bills, orders, stores selling, ASP / ATV / UPT, discount |
| Mitra | Ask anything within scope |
| Category Performance · Product Master · product detail | Which categories and products drive performance; metafield search and filters; product timeline and store distribution |
| Channel Overview | Which channel drives or drags; channel × category matrix; insights |
| Store Overview | Store and format performance, states, distribution and expansion, DSR |
| Online · Marketplace | Channel KPIs vs target, daily chart, warehouse inventory (North / South), top SKUs, returns and cancellations |
| Merchandising | Inventory position, allocation, distribution, excess |
| Action Centre | Actions with evidence and team remarks |
| VM Revamp | Store VM revamp pipeline and before / after performance |
| Admin Lab (admin) | Experimental views |
| Control Centre (admin) | Month targets, daily split, store targets, product attributes, users, rules and tables, change log |
| Demand Planning · Future Inwards · Ads (in the works) | DOI, forecast and OTB; the incoming design pipeline; ads (planned) |
