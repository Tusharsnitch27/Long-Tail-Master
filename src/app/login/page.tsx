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
  session: "Sessions last 8 hours. Sign in again to continue.",
  server: "Sign-in is temporarily unavailable. Try again.",
};

type Tile = ShowcaseItem & { role: string };
/** Top products for the collage. Never blocks sign-in (2.5 s budget; cached 6 h, warmed at startup). */
async function showcase(): Promise<Tile[]> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  return (await Promise.race([getShowcase().catch(() => null), timeout])) ?? [];
}

const serif = { fontFamily: "var(--font-serif)" };

/** One collage tile — only fragrances carry their name. */
function Tile({ t, className = "", i, small }: { t: Tile; className?: string; i: number; small?: boolean }) {
  const named = t.cat === "Fragrance";
  return (
    <figure className={`rise group relative min-h-0 overflow-hidden rounded-[18px] ${t.image ? "bg-[#ece1d2]" : "bg-[#1b1712]"} ${className}`} style={{ animationDelay: `${0.04 * i}s` }}>
      {t.image ? (
        <img src={t.image} alt={t.name} className="absolute inset-0 size-full object-cover mix-blend-multiply transition duration-[1200ms] ease-out group-hover:scale-[1.05]" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#4a3a2a,transparent_65%)] text-center text-[#f3ebe1]">
          <span className="text-[9px] tracking-[0.4em] text-[#d9b48a]">GIFT SET</span>
          <span className={`mt-2 leading-none ${small ? "text-[16px]" : "text-[26px]"}`} style={serif}>{t.name}</span>
          <span className="mt-3 h-px w-10 bg-[#d9b48a]/60" />
        </div>
      )}
      {named && t.image && (
        <figcaption className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent ${small ? "px-2.5 pb-2 pt-6" : "px-5 pb-4 pt-12"}`}>
          <span className={`block truncate leading-none text-white ${small ? "text-[12px]" : "text-[22px]"}`} style={serif}>{t.name}</span>
        </figcaption>
      )}
    </figure>
  );
}

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (!sp.error) {
    const user = await getUser().catch(() => null);
    if (user) redirect(next);
  }
  const err = sp.error ? ERRORS[sp.error] ?? "Sign-in failed." : null;
  const all = await showcase();
  const by = (r: string) => all.filter((t) => t.role === r);
  const [shoeHero] = by("shoe-hero"), shoes = by("shoe"), [perfHero] = by("perfume-hero"), perfs = by("perfume"), acc = by("acc"), trolleys = by("trolley");
  const label = (t: string) => <div className="mb-2 flex items-center gap-3"><span className="text-[10px] font-semibold tracking-[0.4em] text-[#1b1712]/70">{t}</span><span className="h-px flex-1 bg-[#1b1712]/12" /></div>;
  let n = 0;
  return (
    <main className="min-h-dvh bg-[#f3ebe1] text-[#1b1712] lg:h-dvh lg:overflow-hidden">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(900px_500px_at_85%_-10%,#fbf6ef_0%,transparent_60%),radial-gradient(700px_420px_at_0%_110%,#e8d6c1_0%,transparent_60%)]" />
      <div className="relative flex h-full flex-col gap-6 p-6 lg:flex-row lg:p-8">
        {/* left: banner + sections */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="text-[12px] font-semibold tracking-[0.55em]">SNITCH</div>
          <h1 className="rise mt-2 text-[36px] leading-none tracking-[-0.02em] sm:text-[48px] xl:text-[60px]" style={serif}>
            Welcome to <span className="italic text-[#a8703f]">{APP_NAME}</span>
          </h1>
          <div className="mt-6 grid min-h-0 flex-1 gap-5 md:grid-cols-[1.35fr_1fr_0.7fr]">
            {/* footwear */}
            <div className="flex min-h-[420px] flex-col md:min-h-0">
              {label("FOOTWEAR")}
              {shoeHero && <Tile t={shoeHero} i={n++} className="min-h-[240px] flex-1" />}
              {shoes.length > 0 && <div className="mt-3 grid shrink-0 gap-3" style={{ gridTemplateColumns: `repeat(${shoes.length}, minmax(0, 1fr))` }}>{shoes.map((t) => <Tile key={t.sku} t={t} i={n++} className="aspect-square" />)}</div>}
            </div>
            {/* fragrance */}
            <div className="flex min-h-[420px] flex-col md:min-h-0">
              {label("FRAGRANCE")}
              {perfHero && <Tile t={perfHero} i={n++} className="min-h-[240px] flex-1" />}
              {perfs.length > 0 && <div className="mt-3 grid shrink-0 gap-3" style={{ gridTemplateColumns: `repeat(${perfs.length}, minmax(0, 1fr))` }}>{perfs.map((t) => <Tile key={t.sku} t={t} i={n++} small className="aspect-square" />)}</div>}
            </div>
            {/* bags · belts · socks */}
            <div className="flex min-h-[420px] flex-col md:min-h-0">
              {label(["BAGS", "BELTS", acc.some((t) => t.cat === "Socks") ? "SOCKS" : "CAPS"].join(" · "))}
              <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateRows: `repeat(${Math.max(acc.length, 1)}, minmax(0, 1fr))` }}>{acc.map((t) => <Tile key={t.sku} t={t} i={n++} className="min-h-[130px]" />)}</div>
            </div>
          </div>
        </section>
        {/* right: sign-in on top, trolleys below */}
        <aside className="order-first flex shrink-0 flex-col gap-3 lg:order-none lg:w-[300px]">
          <form method="post" action="/api/auth/login" className="rise rounded-[18px] border border-[#1b1712]/10 bg-[#fbf7f1]/92 p-5 shadow-[0_30px_60px_-30px_rgba(60,40,20,.35)] backdrop-blur">
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
          {trolleys.length > 0 && <div className="hidden min-h-0 flex-1 flex-col lg:flex">{label("LUGGAGE")}<div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateRows: `repeat(${trolleys.length}, minmax(0, 1fr))` }}>{trolleys.map((t) => <Tile key={t.sku} t={t} i={n++} className="min-h-0" />)}</div></div>}
        </aside>
      </div>
    </main>
  );
}
