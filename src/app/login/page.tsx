import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";
import { getProducts } from "@/server/data/products";
import { catLabel } from "@/server/views";
import { APP_NAME, APP_TAGLINE } from "@/lib/nav";

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

/** A few best-selling product images for the showcase (never blocks sign-in: 2.5 s budget, silhouettes otherwise). */
async function showcase() {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  const ps = await Promise.race([getProducts().catch(() => null), timeout]);
  if (!ps) return [];
  const byCat = new Map<string, { image: string; name: string; cat: string }>();
  for (const p of [...ps].filter((x) => x.image && x.category).sort((a, b) => (b.l30Sales ?? 0) - (a.l30Sales ?? 0))) {
    if (!byCat.has(p.category!)) byCat.set(p.category!, { image: p.image!, name: p.name ?? p.sku, cat: catLabel(p.category!) });
  }
  return [...byCat.values()].slice(0, 6);
}

const Sil = {
  shoe: <path d="M6 44c0-6 3-10 8-10l10-1 8-10c2-2 5-2 6 0l4 8c6 4 14 6 22 7 4 1 6 4 6 8v3H6z" />,
  perfume: <><rect x="20" y="22" width="30" height="36" rx="6" /><rect x="29" y="12" width="12" height="10" rx="2" /><rect x="26" y="6" width="18" height="6" rx="2" /></>,
  glasses: <><circle cx="20" cy="34" r="11" /><circle cx="50" cy="34" r="11" /><path d="M31 32q4-4 8 0M9 32 4 24M61 32l5-8" strokeWidth="3" fill="none" /></>,
  bag: <><rect x="10" y="22" width="50" height="38" rx="8" /><path d="M24 22v-6a11 11 0 0 1 22 0v6" strokeWidth="4" fill="none" /></>,
  belt: <><rect x="4" y="28" width="62" height="12" rx="4" /><rect x="40" y="24" width="16" height="20" rx="3" fill="none" strokeWidth="3" /></>,
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (!sp.error) {
    const user = await getUser().catch(() => null);
    if (user) redirect(next);
  }
  const err = sp.error ? ERRORS[sp.error] ?? "Sign-in failed." : null;
  const items = await showcase();
  const sils = [
    { k: "shoe", x: "8%", y: "14%", r: "-8deg", s: 1.3 }, { k: "perfume", x: "72%", y: "10%", r: "10deg", s: 1 }, { k: "glasses", x: "64%", y: "72%", r: "-6deg", s: 1.1 },
    { k: "bag", x: "12%", y: "70%", r: "6deg", s: 1 }, { k: "belt", x: "40%", y: "86%", r: "-3deg", s: 0.9 },
  ] as const;
  return (
    <main className="grid min-h-dvh bg-[#07262c] lg:grid-cols-[1.15fr_1fr]">
      {/* showcase */}
      <section className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_20%_10%,#12525e_0%,transparent_60%),radial-gradient(900px_500px_at_90%_90%,#0e8a96_0%,transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
        {sils.map((s, i) => (
          <svg key={s.k} viewBox="0 0 70 64" className="floaty absolute w-28 fill-white/[0.07] stroke-white/[0.12]" strokeWidth="1.5"
            style={{ left: s.x, top: s.y, ["--r" as string]: s.r, animationDelay: `${i * 0.9}s`, width: `${7 * s.s}rem` }}>{Sil[s.k]}</svg>
        ))}
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2.5 text-white">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-brand-500 shadow-[0_6px_24px_rgba(92,192,199,.45)]">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17c4-1 7-4 9-9 1 3 3 6 9 7" /><path d="M12 8V3" /><path d="m9 6 3-3 3 3" /></svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.25em] text-brand-300">Udaan · उड़ान</div>
            <h1 className="mt-3 max-w-xl text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-white">Building the next <span className="bg-gradient-to-r from-brand-300 to-[#e8f7f8] bg-clip-text text-transparent">₹100 Cr</span> business.</h1>
            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-brand-100/70">Perfumes, shoes, bags, belts, sunglasses, accessories and trolleys, across stores, online and marketplaces, all in one place.</p>
            {items.length > 0 && (
              <div className="mt-9 flex gap-3">
                {items.map((p, i) => (
                  <figure key={p.image} className="rise w-[104px] shrink-0 overflow-hidden rounded-2xl bg-white/95 p-1.5 shadow-[0_20px_40px_-12px_rgba(0,0,0,.5)]" style={{ animationDelay: `${0.1 + i * 0.08}s`, transform: `translateY(${i % 2 ? 14 : 0}px) rotate(${(i - 2.5) * 1.6}deg)` }}>
                    <img src={p.image} alt="" className="aspect-square w-full rounded-xl object-cover" />
                    <figcaption className="truncate px-1 pt-1 text-[10px] font-medium text-brand-900">{p.cat}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-8 text-brand-100/70">
            {[["7", "categories"], ["3", "channels"], ["140+", "stores"]].map(([v, l]) => (
              <div key={l}><div className="text-[22px] font-semibold text-white">{v}</div><div className="text-[11.5px]">{l}</div></div>
            ))}
          </div>
        </div>
      </section>
      {/* sign-in */}
      <section className="flex items-center justify-center bg-canvas p-6 lg:rounded-l-[28px]">
        <form method="post" action="/api/auth/login" className="rise w-full max-w-sm">
          <div className="lg:hidden mb-6 flex items-center gap-2 text-brand-900"><span className="size-7 rounded-lg bg-brand-500" /><span className="font-semibold">{APP_NAME}</span></div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.2em] text-brand-600">Welcome to</div>
          <h2 className="mt-1 text-[30px] font-semibold tracking-[-0.025em] text-ink">{APP_NAME}</h2>
          <p className="mt-1 text-[13.5px] font-medium text-brand-700">{APP_TAGLINE}</p>
          {err && <div role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">{err}</div>}
          {sp.signedout && !err && <div className="mt-5 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] text-zinc-700">You’ve been signed out.</div>}
          <input type="hidden" name="next" value={next} />
          <label className="mt-7 block text-[12.5px] font-medium text-zinc-700">Username
            <input name="username" autoComplete="username" required autoFocus={!sp.u} defaultValue={sp.u ?? ""} autoCapitalize="none" spellCheck={false}
              className="mt-1.5 h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[14px] outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
          </label>
          <label className="mt-3.5 block text-[12.5px] font-medium text-zinc-700">Password
            <input name="password" type="password" autoComplete="current-password" required autoFocus={!!sp.u}
              className="mt-1.5 h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[14px] outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
          </label>
          <button type="submit" className="mt-6 h-11 w-full rounded-xl bg-gradient-to-r from-brand-700 to-brand-500 text-[14px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(14,138,150,.6)] transition hover:brightness-110">Take off →</button>
          <p className="mt-5 text-center text-[12px] text-zinc-500">Accounts are created by an admin. Forgot your password? Ask an admin to reset it.</p>
        </form>
      </section>
    </main>
  );
}
