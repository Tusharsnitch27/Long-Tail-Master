// Runs once per server start: apply PostgreSQL migrations early so the first request isn't slowed.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { migrate } = await import("./server/db");
  await migrate().catch((e) => console.error("[db] migration failed at startup", e));
}
