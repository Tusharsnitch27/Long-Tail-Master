// Runs once per server start: apply PostgreSQL migrations and create the bootstrap admin so the first login works.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { migrate } = await import("./server/db");
  const { ensureBootstrapAdmin } = await import("./server/auth");
  await migrate().then(ensureBootstrapAdmin).catch((e) => console.error("[db] startup migration/bootstrap failed", e));
}
