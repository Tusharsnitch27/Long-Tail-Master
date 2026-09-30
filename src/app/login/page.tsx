import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";
import { getShowcase } from "@/server/showcase";
import { CATEGORIES } from "@/lib/categories";
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

const LABEL: Record<string, string> = { shoes: "Footwear", perfumes: "Fragrance", bags: "Bags", sunglasses: "Eyewear", belts: "Belts", accessories: "Accessories", luggage: "Luggage" };
const ORDER = ["shoes", "perfumes", "bags", "sunglasses", "belts", "accessories", "luggage"];

/** Best sellers per category (last 30 days), names and images only. Never blocks sign-in (2.5 s budget; cached 6 h). */
async function showcase() {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  return (await Promise.race([getShowcase().catch(() => null), timeout])) ?? {};
}

const serif = { fontFamily: '"Playfair Display", "Didot", "Bodoni 72", "Times New Roman", ui-serif, Georgia, serif' };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (!sp.error) {
    const user = await getUser().catch(() => null);
    if (user) redirect(next);
  }
  const err = sp.error ? ERRORS[sp.error] ?? "Sign-in failed." : null;
  const top = await showcase();
  const cats = ORDER.filter((k) => CATEGORIES.some((c) => c.key === k));
  // interleave categories so the wall mixes products; only categories that have products are shown
  const lists = ORDER.filter((k) => CATEGORIES.some((c) => c.key === k)).map((k) => (top[k] ?? []).map((p) => ({ ...p, cat: LABEL[k] }))).filter((x) => x.length);
  const wall: { sku: string; name: string; image: string; cat: string }[] = [];
  for (let i = 0; i < 3; i++) for (const l of lists) if (l[i]) wall.push(l[i]);
  return (
    <main className="min-h-dvh bg-[#f3ebe1] text-[#1b1712]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(900px_500px_at_85%_-10%,#fbf6ef_0%,transparent_60%),radial-gradient(700px_420px_at_0%_110%,#ead9c6_0%,transparent_60%)]" />
      <div className="relative grid min-h-dvh lg:grid-cols-[1fr_440px]">
        <section className="px-6 py-8 lg:px-10">
          <div className="text-[13px] font-semibold tracking-[0.55em]">SNITCH</div>
          <div className="mt-3 h-px w-24 bg-[#1b1712]/40" />
          <div className="mt-8 columns-2 gap-4 sm:columns-3 xl:columns-4 2xl:columns-5 [column-fill:_balance]">
            {wall.map((p, i) => (
              <figure key={p.sku} className="rise group mb-4 break-inside-avoid" style={{ animationDelay: `${0.03 * i}s` }}>
                <div className="overflow-hidden rounded-2xl bg-[#ece1d2] shadow-[0_18px_30px_-24px_rgba(60,40,20,.6)]">
                  <img src={p.image} alt={p.name} loading={i < 8 ? "eager" : "lazy"} className={`w-full object-cover mix-blend-multiply transition duration-700 group-hover:scale-[1.05] ${i % 3 === 0 ? "aspect-[4/5]" : i % 3 === 1 ? "aspect-square" : "aspect-[5/6]"}`} />
                </div>
                <figcaption className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-medium tracking-wide">{p.name}</span>
                  <span className="shrink-0 text-[9.5px] tracking-[0.25em] text-[#a8703f]">{p.cat.toUpperCase()}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
        <aside className="order-first flex items-center justify-center px-6 py-10 lg:order-none lg:sticky lg:top-0 lg:h-dvh">
          <form method="post" action="/api/auth/login" className="rise w-full max-w-sm rounded-[22px] border border-[#1b1712]/10 bg-[#fbf7f1]/90 p-7 shadow-[0_30px_60px_-30px_rgba(60,40,20,.35)] backdrop-blur">
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#a8703f]">Welcome to</div>
            <h2 className="mt-1.5 text-[30px] leading-tight" style={serif}>{APP_NAME}</h2>
            {err && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">{err}</div>}
            {sp.signedout && !err && <div className="mt-4 rounded-lg border border-[#1b1712]/10 bg-white px-3 py-2 text-[12.5px] text-[#1b1712]/70">You’ve been signed out.</div>}
            <input type="hidden" name="next" value={next} />
            <label className="mt-6 block text-[12px] font-medium tracking-wide text-[#1b1712]/70">Username
              <input name="username" autoComplete="username" required autoFocus={!sp.u} defaultValue={sp.u ?? ""} autoCapitalize="none" spellCheck={false}
                className="mt-1.5 h-11 w-full rounded-xl border border-[#1b1712]/15 bg-white px-3.5 text-[14px] outline-none transition focus:border-[#a8703f] focus:ring-4 focus:ring-[#a8703f]/15" />
            </label>
            <label className="mt-3.5 block text-[12px] font-medium tracking-wide text-[#1b1712]/70">Password
              <input name="password" type="password" autoComplete="current-password" required autoFocus={!!sp.u}
                className="mt-1.5 h-11 w-full rounded-xl border border-[#1b1712]/15 bg-white px-3.5 text-[14px] outline-none transition focus:border-[#a8703f] focus:ring-4 focus:ring-[#a8703f]/15" />
            </label>
            <button type="submit" className="mt-6 h-11 w-full rounded-xl bg-[#1b1712] text-[13px] font-semibold tracking-[0.2em] text-[#f3ebe1] transition hover:bg-[#3a2f24]">SIGN IN</button>
            <p className="mt-4 text-center text-[11.5px] text-[#1b1712]/50">Accounts are created by an admin. Forgot your password? Ask an admin to reset it.</p>
          </form>
        </aside>
      </div>
    </main>
  );
}
