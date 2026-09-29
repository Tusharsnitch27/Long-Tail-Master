// Runs once per server start: apply PostgreSQL migrations and create the bootstrap admin so the first login works.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const db = process.env.DATABASE_URL ?? "";
  if (!db) console.warn("[config] DATABASE_URL is not set — only the ADMIN_USERNAME/ADMIN_PASSWORD account can sign in");
  if (process.env.NODE_ENV === "production" && /@(127\.0\.0\.1|localhost)[:/]/.test(db)) {
    console.error("[config] DATABASE_URL points at localhost — inside a container that is the container itself. Use the Coolify PostgreSQL internal URL.");
  }
  if (process.env.NODE_ENV === "production" && process.env.AUTH_MODE === "dev") console.warn("[config] AUTH_MODE=dev is ignored in production — remove it");
  if (!db) return;
  const { migrate } = await import("./server/db");
  const { ensureBootstrapAdmin } = await import("./server/auth");
  await migrate().then(ensureBootstrapAdmin).catch((e) => console.error("[db] startup migration/bootstrap failed", e));
}
