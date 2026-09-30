import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";
import { getShowcase, type ShowcaseItem } from "@/server/showcase";
import { APP_NAME } from "@/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };

const ERRORS: Record<string, string> = {
  invalid: "Incorrect username or password.",
  missing: "Enter your username and password.",
  locked: "Too many failed attempts. Try again in 15 minutes.",
  denied: "Your account has been disabled. Contact an admin.",
  session: "Your session has expired. Sign in again.",
  server: "Sign-in is temporarily unavailable. Try again.",
};

/** Top products for the collage. Never blocks sign-in (2.5 s budget; cached 6 h, warmed at startup). */
async function showcase(): Promise<ShowcaseItem[]> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  return (await Promise.race([getShowcase().catch(() => null), timeout])) ?? [];
}

const serif = { fontFamily: '"Playfair Display", "Didot", "Bodoni 72", "Times New Roman", ui-serif, Georgia, serif' };
const ROWS = 4, BIG = 4;

/** Interleave categories so neighbours differ, then show the first product of four categories as 2×2 tiles. */
function layout(items: ShowcaseItem[]) {
  const groups = new Map<string, ShowcaseItem[]>();
  for (const x of items) { const k = x.cat.split(" · ")[0]; groups.set(k, [...(groups.get(k) ?? []), x]); }
  const order: ShowcaseItem[] = [];
  for (let i = 0; order.length < items.length; i++) for (const g of groups.values()) if (g[i]) order.push(g[i]);
  const bigs = new Set([...groups.values()].filter((g) => g[0]?.image).slice(0, BIG).map((g) => g[0].sku));
  // the grid must fill exactly: cells = tiles + 3 × bigs, a multiple of ROWS
  const nBig = (ts: ShowcaseItem[]) => ts.filter((t) => bigs.has(t.sku)).length;
  let tiles = order;
  while (tiles.length && (tiles.length + 3 * nBig(tiles)) % ROWS) tiles = tiles.slice(0, -1);
  return { tiles, bigs, cols: Math.max(1, (tiles.length + 3 * nBig(tiles)) / ROWS) };
}

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (!sp.error) {
    const user = await getUser().catch(() => null);
    if (user) redirect(next);
  }
  const err = sp.error ? ERRORS[sp.error] ?? "Sign-in failed." : null;
  const { tiles, bigs, cols } = layout(await showcase());
  const cats = [...new Set(tiles.map((t) => t.cat.split(" · ")[0]))];
  return (
    <main className="flex min-h-dvh flex-col bg-[#f3ebe1] text-[#1b1712] lg:h-dvh lg:overflow-hidden">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(900px_500px_at_85%_-10%,#fbf6ef_0%,transparent_60%),radial-gradient(700px_420px_at_0%_110%,#e8d6c1_0%,transparent_60%)]" />
      {/* banner */}
      <header className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-2 px-6 pt-5 lg:px-10 lg:pt-6">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.55em]">SNITCH</div>
          <h1 className="rise mt-2 text-[34px] leading-none tracking-[-0.02em] sm:text-[46px] xl:text-[56px]" style={serif}>
            Welcome to <span className="italic text-[#a8703f]">{APP_NAME}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pb-1 text-[10.5px] tracking-[0.32em] text-[#1b1712]/60">
          {cats.map((c, i) => <span key={c}>{i ? <span className="mr-3 text-[#a8703f]">·</span> : null}{c.toUpperCase()}</span>)}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col gap-5 px-6 py-5 lg:flex-row lg:px-10">
        {/* collage */}
        <div className="grid min-h-[520px] flex-1 gap-2.5 lg:min-h-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`, gridAutoFlow: "dense" }}>
          {tiles.map((t, i) => {
            const big = bigs.has(t.sku);
            return (
              <figure key={t.sku} className={`rise group relative min-h-0 overflow-hidden rounded-2xl ${t.image ? "bg-[#ece1d2]" : "bg-[#1b1712]"} ${big ? "col-span-2 row-span-2" : ""}`} style={{ animationDelay: `${0.025 * i}s` }}>
                {t.image ? (
                  <img src={t.image} alt={t.name} className="absolute inset-0 size-full object-cover mix-blend-multiply transition duration-[900ms] group-hover:scale-[1.06]" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#4a3a2a,transparent_60%)] p-3 text-center text-[#f3ebe1]">
                    <span className="text-[9px] tracking-[0.35em] text-[#d9b48a]">GIFT SET</span>
                    <span className="mt-1.5 text-[22px] leading-none" style={serif}>{t.name}</span>
                    <span className="mt-2 h-px w-8 bg-[#d9b48a]/60" />
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-[#f3ebe1]/85 px-2 py-0.5 text-[8.5px] font-semibold tracking-[0.25em] text-[#1b1712]/80 backdrop-blur">{t.cat.split(" · ")[0].toUpperCase()}</span>
                {t.image && (
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#f3ebe1] via-[#f3ebe1]/85 to-transparent px-2.5 pb-2 pt-6">
                    <span className={`block truncate font-medium tracking-wide ${big ? "text-[13px]" : "text-[11px]"}`}>{t.name}</span>
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>

        {/* sign-in */}
        <aside className="order-first flex shrink-0 items-center lg:order-none lg:w-[300px]">
          <form method="post" action="/api/auth/login" className="rise w-full rounded-[20px] border border-[#1b1712]/10 bg-[#fbf7f1]/92 p-5 shadow-[0_30px_60px_-30px_rgba(60,40,20,.35)] backdrop-blur">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#a8703f]">Sign in</div>
            {err && <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-900">{err}</div>}
            {sp.signedout && !err && <div className="mt-3 rounded-lg border border-[#1b1712]/10 bg-white px-2.5 py-1.5 text-[12px] text-[#1b1712]/70">You’ve been signed out.</div>}
            <input type="hidden" name="next" value={next} />
            <label className="mt-3.5 block text-[11.5px] font-medium tracking-wide text-[#1b1712]/70">Username
              <input name="username" autoComplete="username" required defaultValue={sp.u ?? ""} autoCapitalize="none" spellCheck={false}
                className="mt-1 h-10 w-full rounded-xl border border-[#1b1712]/15 bg-white px-3 text-[13.5px] outline-none transition focus:border-[#a8703f] focus:ring-4 focus:ring-[#a8703f]/15" />
            </label>
            <label className="mt-3 block text-[11.5px] font-medium tracking-wide text-[#1b1712]/70">Password
              <input name="password" type="password" autoComplete="current-password" required
                className="mt-1 h-10 w-full rounded-xl border border-[#1b1712]/15 bg-white px-3 text-[13.5px] outline-none transition focus:border-[#a8703f] focus:ring-4 focus:ring-[#a8703f]/15" />
            </label>
            <button type="submit" className="mt-4 h-10 w-full rounded-xl bg-[#1b1712] text-[12px] font-semibold tracking-[0.25em] text-[#f3ebe1] transition hover:bg-[#3a2f24]">SIGN IN</button>
            <p className="mt-3 text-center text-[10.5px] leading-snug text-[#1b1712]/50">Accounts are created by an admin. Forgot your password? Ask an admin to reset it.</p>
          </form>
        </aside>
      </div>
    </main>
  );
}
