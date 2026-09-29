import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { sfCached } from "../snowflake";

export interface Store {
  branch_code: string;
  store_name: string;
  short_name: string;
  operating_model: string | null;
  state: string | null;
  region: string | null;
  city: string | null;
  city_type: string | null;
  location_type: string | null;
  store_status: string | null;
  am: string | null;
  rm: string | null;
  partner: string | null;
  last_seen: string | null;
}

const T = (t: string) => `SNITCH_DB.MAPLEMONK.${t}`;

/** Store dimension: latest attributes per BRANCH_CODE across DSR tables, plus branches that only exist in target tables. */
export async function getStores(): Promise<Store[]> {
  const dsr = CATEGORIES.filter((c) => c.source === "dsr");
  const cols = "branch_code, store_name, operating_model, state, region, city, city_type, upper(location_type) location_type, store_status, am, rm, partner, date";
  const union = dsr.map((c) => `select ${cols} from ${T(c.dsrTable!)}`).join(" union all ");
  const tgt = dsr.map((c) => `select distinct branch_code from ${T(c.targetTable!)} where date >= dateadd(month, -2, current_date)`).join(" union ");
  const sql = `
    with u as (${union}),
    latest as (
      select branch_code, trim(store_name) store_name, operating_model, state, region, city, city_type, location_type, store_status, am, rm, partner, to_varchar(date) last_seen
      from u qualify row_number() over (partition by branch_code order by date desc) = 1
    )
    select coalesce(l.branch_code, t.branch_code) branch_code, l.store_name, l.operating_model, l.state, l.region, l.city, l.city_type,
           l.location_type, l.store_status, l.am, l.rm, l.partner, l.last_seen
    from latest l full outer join (${tgt}) t on t.branch_code = l.branch_code`;
  const rows = await sfCached<Omit<Store, "short_name">>("stores", sql, [], 1800);
  return rows
    .map((r) => {
      const name = r.store_name ?? `Branch ${r.branch_code}`;
      return { ...r, store_name: name, short_name: name.replace(/^SNITCH\s*-\s*/i, "") };
    })
    .sort((a, b) => a.short_name.localeCompare(b.short_name));
}

export async function getStoreMap() {
  const stores = await getStores();
  return {
    stores,
    byCode: new Map(stores.map((s) => [s.branch_code, s])),
    byName: new Map(stores.map((s) => [s.store_name.toUpperCase(), s])),
  };
}
