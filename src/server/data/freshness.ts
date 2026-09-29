import "server-only";
import { istToday, addDays } from "@/lib/dates";
import { CATEGORIES } from "@/lib/categories";
import { sfCached } from "../snowflake";

/** Latest refresh time of source tables + latest complete business day. */
export async function getFreshness() {
  const dsr = CATEGORIES.filter((c) => c.source === "dsr");
  const tables = [...dsr.map((c) => c.dsrTable!), "LONG_TAIL_MASTER_BIBLE", "HORIZONTAL_SALES_CATEGORIES"];
  const rows = await sfCached<{ table_name: string; last_altered: Date }>(
    "freshness",
    `select table_name, last_altered from SNITCH_DB.information_schema.tables where table_schema = 'MAPLEMONK' and table_name in (${tables.map(() => "?").join(",")})`,
    tables,
    300,
  );
  const maxDates = await sfCached<{ d: string }>(
    "maxdate",
    `select to_varchar(max(date)) d from (${dsr.map((c) => `select max(date) date from SNITCH_DB.MAPLEMONK.${c.dsrTable}`).join(" union all ")})`,
    [],
    300,
  );
  const today = istToday();
  const latest = maxDates[0]?.d ?? addDays(today, -1);
  const asOf = latest >= today ? addDays(today, -1) : latest;
  const refreshed = rows.reduce<Date | null>((m, r) => (!m || new Date(r.last_altered) > m ? new Date(r.last_altered) : m), null);
  return {
    today,
    asOf,
    refreshedAt: refreshed?.toISOString() ?? null,
    tables: Object.fromEntries(rows.map((r) => [r.table_name, new Date(r.last_altered).toISOString()])),
  };
}
