import "server-only";
import { cached, invalidate } from "@/lib/cache";
import { DEFAULT_ENABLED } from "@/lib/categories";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/metrics";
import { dbConfigured, q } from "./db";

export interface ExceptionRules {
  /** WoW decline that flags a store/SKU, e.g. -0.3 = -30% */
  wowDecline: number;
  /** SKU store penetration below which a strong SKU is flagged (0-1) */
  lowPenetration: number;
  /** required run rate / achieved daily rate above which a store is flagged */
  highRunRateMultiple: number;
  /** SKUs selling in this many stores or fewer are flagged */
  fewStores: number;
}

export interface AppSettings {
  thresholds: Thresholds;
  exceptions: ExceptionRules;
  enabledCategories: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  thresholds: DEFAULT_THRESHOLDS,
  exceptions: { wowDecline: -0.3, lowPenetration: 0.3, highRunRateMultiple: 1.5, fewStores: 5 },
  enabledCategories: DEFAULT_ENABLED,
};

export function getSettings(): Promise<AppSettings> {
  return cached("settings", 30, async () => {
    if (!dbConfigured()) return DEFAULT_SETTINGS;
    try {
      const rows = await q<{ key: string; value: unknown }>("select key, value from app_settings");
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return {
        thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(m.thresholds as object) },
        exceptions: { ...DEFAULT_SETTINGS.exceptions, ...(m.exceptions as object) },
        enabledCategories: (m.enabledCategories as string[]) ?? DEFAULT_SETTINGS.enabledCategories,
      };
    } catch (e) {
      console.error("[settings] falling back to defaults", e);
      return DEFAULT_SETTINGS;
    }
  });
}

export async function saveSetting(key: keyof AppSettings, value: unknown, actor: string) {
  await q(
    `insert into app_settings(key, value, updated_by, updated_at) values ($1, $2, $3, now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), actor],
  );
  await q("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,'update','setting',$2,$3)", [actor, key, JSON.stringify(value)]);
  invalidate("settings");
}
