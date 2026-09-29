import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Where Claude runs.
 *  - snowflake (default): Snowflake Cortex's Anthropic-compatible Messages endpoint, authenticated with the same
 *    SNOWFLAKE_PAT the data layer uses. Billed to Snowflake credits; data stays inside the Snowflake boundary.
 *    Cortex rejects `strict` tools and server-side `fallbacks`, so both are disabled for this provider.
 *  - anthropic: api.anthropic.com with ANTHROPIC_API_KEY.
 */
export type Provider = "snowflake" | "anthropic";

export function aiProvider(): Provider | null {
  const want = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (want === "anthropic") return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
  if (want === "snowflake") return process.env.SNOWFLAKE_PAT && process.env.SNOWFLAKE_ACCOUNT ? "snowflake" : null;
  if (process.env.SNOWFLAKE_PAT && process.env.SNOWFLAKE_ACCOUNT) return "snowflake";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
}

export const aiConfigured = () => aiProvider() !== null;

const g = globalThis as unknown as { __aiClient?: { p: Provider; c: Anthropic } };

export function aiClient(): { client: Anthropic; provider: Provider } {
  const p = aiProvider();
  if (!p) throw new Error("AI provider not configured");
  if (g.__aiClient?.p === p) return { client: g.__aiClient.c, provider: p };
  const client = p === "snowflake"
    ? new Anthropic({
        apiKey: null,
        authToken: process.env.SNOWFLAKE_PAT,
        baseURL: process.env.AI_SNOWFLAKE_BASE_URL || `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex`,
        defaultHeaders: { "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN" },
        maxRetries: 2,
      })
    : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.AI_BASE_URL || "https://api.anthropic.com" });
  g.__aiClient = { p, c: client };
  return { client, provider: p };
}

/** Per-provider request features. */
export const providerFeatures = (p: Provider) => ({
  strictTools: p === "anthropic",
  serverFallbacks: p === "anthropic",
});
