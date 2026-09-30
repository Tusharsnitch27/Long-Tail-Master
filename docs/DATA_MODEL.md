# Data model & source audit

Profiled against Snowflake `SNITCH_DB.MAPLEMONK` on 29 Sep 2026 (role `BUSINESS_ANALYST1`).

## Source tables

| Table | Grain | Rows | Range | Used for |
|---|---|---|---|---|
| `LONG_TAIL_DSR_PERFUMES` | store × day (**only days with a sale**) | 47,575 | 2023-08-12 → today (partial) | Store revenue, units, bills, MRP value |
| `LONG_TAIL_DSR_SHOES` | store × day (**only days with a sale**) | 18,072 | 2023-10-30 → today (partial) | same |
| `MTD_TARGET_PERFUMES` / `MTD_TARGET_SHOES` | store × day, **every day** incl. future days of the month | 60,169 each | 2024-05 → month end | Base daily targets (these feed the DSR `TARGET` column) |
| `HORIZONTAL_SALES_CATEGORIES` | order line (all categories, all channels) | 19.3 M | — | SKU-level and Store × SKU sales |
| `LONG_TAIL_MASTER_BIBLE` | SKU (**perfumes only**, 44 SKUs) | 44 | refreshed daily | Product attributes, inventory, lifetime metrics |
| `LONG_TAIL_PRODUCT_INVENTORY_MASTER` | SKU (all long-tail cats) | 671 | **last refreshed 23 Jul 2026** | Names / colour / vendor / status only |

> The two target tables and the inventory master were not in the original brief; they were added because the DSR
> alone cannot produce correct targets (see below) and the Bible has no shoe rows.

### Key columns

**DSR (`LONG_TAIL_DSR_*`)** — `DATE`, `MONTH`, `BRANCH_CODE` (varchar store id), `STORE_NAME`, `OPERATING_MODEL`
(COCO/COFO/FOCO), `STATE`, `REGION`, `CITY`, `CITY_TYPE`, `LOCATION_TYPE`, `STORE_STATUS` (FRESH/OUTLET), `PARTNER`, `AM`, `RM`, `NSM`,
`TARGET`, `SALES` (gross, before returns; matches horizontal GROSS_SALES within 0.5%), `MTD_TARGET`, `MTD_SALES`, `BILLS`, `QTY`, `MRP_SALES`, `COGS_SALES`, `DISC_PCT`, `ASP`, `ATV_*`, `UPT_*`,
new/repeat splits, L2L, omni, footfall/conversion, and inventory columns (`INV_*`, `*_OPTIONS`) which are **null** in current rows.

**Targets (`MTD_TARGET_*`)** — `DATE`, `BRANCH_CODE`, `TARGET` (daily), `MTD_TARGET` (cumulative).

**Sales (`HORIZONTAL_SALES_CATEGORIES`)** — `DATE`, `TYPE` (Store / Shopify / Marketplace), `CHANNEL` (store name when TYPE = Store,
else App2_Android / web2 / Web / MYNTRA / AJIO / NYKAA / FLIPKART), `SKU_GROUP`, `SIZE`, `CATEGORY`, `PRICE` (MRP), `COST_PRICE`,
`GROSS_SALES`, `GROSS_QUANTITY`, `DISCOUNT_AMOUNT`, `PRODUCT_TAGS` (variant array), `IMAGE_URL`.

**Bible** — `SKU_GROUP`, `PRODUCT_NAME`, `CATEGORY`, attribute columns (`DESIGNS`, `FIT`, `MATERIAL`… mostly `NO_*` for long-tail),
`MRP`, `COGS`, `LIVE_DATE`, `LIFECYCLE_STATUS` (LIVE/HISTORICAL), `ALLOCATION_STATUS`, `TOTAL/WH/OFFLINE_INV_ALL`, `STORE_COUNT_ALL`,
L30/L60/L90/TD sales & qty per channel, return %, GP %.

## Join keys

| From → To | Key | Match |
|---|---|---|
| DSR ↔ targets | `DATE` + `BRANCH_CODE` | 100% for current month (2 DSR rows in Sep lack a target row) |
| DSR store ↔ sales `CHANNEL` (TYPE = Store) | `upper(trim(STORE_NAME)) = upper(trim(CHANNEL))` | 136 of 139 stores; 3 stores in sales only (City Center Nashik, Vasupujya, Boulevard Walk — new, no DSR rows yet) |
| Sales ↔ Bible / inventory master | `SKU_GROUP` | Perfumes: 39/39 SKUs sold in 2026 are in the Bible. Shoes: 212/221 in the inventory master |

`BRANCH_CODE` is the store key everywhere in the app. Store attributes come from the latest DSR row per branch.

## Data quality findings

1. **DSR has no rows for zero-sale store-days.** Summing DSR `TARGET` under-counts targets (shoes on 28 Sep: ₹0.91 L in DSR vs
   ₹2.34 L in `MTD_TARGET_SHOES`). The app full-outer-joins DSR to the target table, so zero-sale days keep their target.
2. **Duplicate target rows** — 121 duplicate (date, branch) rows in each target table (and 15 duplicate DSR rows for
   ELPRO MALL, Jun 2025, identical sales / different targets). Deduplicated with `max(target)` / `row_number()`.
3. **Inconsistent casing** — `LOCATION_TYPE` has `HS` and `Hs`; normalised with `upper()`.
4. **Branch 166** has targets but has never appeared in either DSR → shown as “Branch 166”. Several stores (e.g. Dimapur,
   Hilite, RR Nagar) carry September targets with zero sales all month — visible in Targets → Daily Targets.
5. **Today is partial** — the DSR contains the current day as it fills. The app’s as-of date is the last complete day
   (yesterday IST); “Today” is available and labelled partial.
6. **Sales vs DSR** — horizontal sales are gross line values; DSR `SALES` is net. Sep 1–28: perfumes ₹1.052 Cr (sales) vs
   ₹1.046 Cr (DSR); shoes ₹56.5 L vs ₹55.0 L. Store/target views use DSR; SKU views use horizontal sales. Both are labelled.
7. **Negative lines** — 5 perfume and 1 shoe line with negative `GROSS_SALES` in 2026 (returns/adjustments); kept as-is.
8. **Stale inventory master** — `LONG_TAIL_PRODUCT_INVENTORY_MASTER.REFRESHED_AT` = 23 Jul 2026. Its inventory, ROS, STR and
   reorder columns are **not** used. Only fresh Bible inventory is shown (perfumes). Shoes show inventory as “n/a”.
9. **No store-level SKU inventory** exists in the provided tables, so Store × SKU shows sales velocity and days since last sale,
   not stock.
10. `SIZE` for shoes is populated with apparel sizes (3XL/4XL/5XL) — ignored.
11. **No “cluster” dimension** exists. Area manager (`AM`) is offered as the closest grouping.

## Metric definitions

| Metric | Definition |
|---|---|
| Revenue | Σ DSR `SALES` (gross, before returns; matches horizontal GROSS_SALES within 0.5%) — store views; Σ `GROSS_SALES` — SKU views |
| Target | Σ effective daily target over the selected dates (phased; weekends carry more) |
| Achievement % | Revenue ÷ target (— when target is 0/missing) |
| Gap | Target − revenue (negative = above target) |
| Status | Ahead ≥ 105%, On Track ≥ 95%, At Risk ≥ 80%, Behind < 80%, No Target — thresholds editable in Admin |
| Active store | Store with a target > 0 or a sale in the period |
| Stores selling | Stores with ≥ 1 sale in the period |
| Sales / store / day | Revenue ÷ (active stores × days) |
| ASP / ATV / UPT | Revenue ÷ units / revenue ÷ bills / units ÷ bills |
| Discount % | 1 − revenue ÷ MRP value |
| Projected month-end | (MTD revenue ÷ MTD target) × full-month target — phasing-aware; linear run-rate when there is no target |
| Required run rate | max(month target − MTD revenue, 0) ÷ remaining days |
| SKU penetration | Stores where the SKU sold ÷ in-scope stores active in the last 45 days |
| WoW | Current week to date vs the same weekdays of the previous week (weeks are Mon–Sun) |
| MTD comparison | vs previous month days 1…N (partial); the complete previous month is shown separately and labelled |

## Targets (PostgreSQL)

Snowflake targets are the base. Overrides live in `target_overrides` (category, branch_code or `*`, grain month/week/day,
period_start, target) and every change is appended to `target_history`.

Resolution per store-day: **day override → week override → month override → Snowflake base**. Month/week overrides are spread
across days in proportion to the Snowflake daily phasing (even split if none). A category-level (`*`) month target then scales all
store targets in that category-month so they sum to it.
