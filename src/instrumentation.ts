// Runs once per server start. Node-only work lives in instrumentation-node.ts (kept out of the Edge bundle).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNode } = await import("./instrumentation-node");
    await startNode();
  }
}
