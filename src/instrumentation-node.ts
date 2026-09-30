// Node-runtime startup work (migrations, bootstrap admin, cache warm-up). Imported only when NEXT_RUNTIME === "nodejs"
// so none of these server dependencies end up in the Edge instrumentation bundle.
export async function startNode() {
  const db = process.env.DATABASE_URL ?? "";
  if (!db) console.warn("[config] DATABASE_URL is not set — only the ADMIN_USERNAME/ADMIN_PASSWORD account can sign in");
  if (process.env.NODE_ENV === "production" && /@(127\.0\.0\.1|localhost)[:/]/.test(db)) {
    console.error("[config] DATABASE_URL points at localhost — inside a container that is the container itself. Use the Coolify PostgreSQL internal URL.");
  }
  if (process.env.NODE_ENV === "production" && process.env.AUTH_MODE === "dev") console.warn("[config] AUTH_MODE=dev is ignored in production — remove it");
  if (process.env.SNOWFLAKE_ACCOUNT) setTimeout(() => void prewarm(), 2000);
  if (!db) return;
  const { migrate } = await import("./server/db");
  const { ensureBootstrapAdmin } = await import("./server/auth");
  await migrate().then(ensureBootstrapAdmin).catch((e) => console.error("[db] startup migration/bootstrap failed", e));
}

/** Warm the heaviest shared queries so the first visitor doesn't wait on a cold warehouse (runs in the background). */
async function prewarm() {
  try {
    const { pageContext } = await import("./server/context");
    const { loadScope, productPerformance } = await import("./server/scope");
    const { buildActions } = await import("./server/actions");
    const { getShowcase } = await import("./server/showcase");
    void getShowcase().catch(() => undefined);
    const ctx = await pageContext(Promise.resolve({}));
    const sc = await loadScope(ctx);
    await Promise.all([buildActions(ctx), productPerformance(ctx, sc.pm, (s) => sc.wh.bySku.get(s)?.units ?? 0)]);
    console.log("[warm] caches ready");
  } catch (e) {
    console.warn("[warm] skipped", e instanceof Error ? e.message : e);
  }
}
