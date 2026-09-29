import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Incorrect username or password.",
  missing: "Enter your username and password.",
  locked: "Too many failed attempts. Try again in 15 minutes.",
  denied: "Your account has been disabled. Contact an admin.",
  session: "Your session has expired. Please sign in again.",
  server: "Sign-in is temporarily unavailable. Please try again.",
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (!sp.error) {
    const user = await getUser().catch(() => null);
    if (user) redirect(next);
  }
  const err = sp.error ? ERRORS[sp.error] ?? "Sign-in failed." : null;
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form method="post" action="/api/auth/login" className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-7">
        <div className="text-[17px] font-semibold tracking-tight">Long-Tail Ops</div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">Snitch · Offline</div>
        {err && <div role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">{err}</div>}
        {sp.signedout && !err && <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-700">You’ve been signed out.</div>}
        <input type="hidden" name="next" value={next} />
        <label className="mt-5 block text-[12.5px] font-medium text-zinc-700">Username
          <input name="username" autoComplete="username" required autoFocus={!sp.u} defaultValue={sp.u ?? ""} autoCapitalize="none" spellCheck={false}
            className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-[14px] outline-none focus:border-brand-500" />
        </label>
        <label className="mt-3 block text-[12.5px] font-medium text-zinc-700">Password
          <input name="password" type="password" autoComplete="current-password" required autoFocus={!!sp.u}
            className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-[14px] outline-none focus:border-brand-500" />
        </label>
        <button type="submit" className="mt-5 h-10 w-full rounded-md bg-zinc-900 text-[13.5px] font-medium text-white hover:bg-zinc-800">Sign in</button>
        <p className="mt-4 text-center text-[12px] text-zinc-500">Accounts are created by an admin. Forgot your password? Ask an admin to reset it.</p>
      </form>
    </main>
  );
}
