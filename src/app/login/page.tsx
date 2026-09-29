import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { safeNext } from "@/lib/session";

const ERRORS: Record<string, string> = {
  denied: "This Google account isn’t on the allowed list. Ask an admin to add your email, or sign in with a different account.",
  unverified: "Your Google email address isn’t verified.",
  cancelled: "Sign-in was cancelled.",
  state: "Sign-in could not be verified. Please try again.",
  expired: "The sign-in attempt expired. Please try again.",
  google: "Google sign-in failed. Please try again.",
  session: "Your session could not be verified. Please sign in again.",
  config: "Google sign-in is not configured (GOOGLE_CLIENT_ID missing).",
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
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-7">
        <div className="text-[17px] font-semibold tracking-tight">Long-Tail Ops</div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">Snitch · Offline</div>
        <p className="mt-5 text-[13px] text-zinc-600">Sign in with your Google account. Access is limited to approved email addresses.</p>
        {err && <div role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">{err}</div>}
        {sp.signedout && !err && <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-700">You’ve been signed out.</div>}
        <a href={`/api/auth/google?next=${encodeURIComponent(next)}`}
          className="mt-5 flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-zinc-300 bg-white text-[13.5px] font-medium hover:bg-zinc-50">
          <svg viewBox="0 0 48 48" className="size-4" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Sign in with Google
        </a>
        {sp.error === "denied" && <p className="mt-3 text-center text-[12px] text-zinc-500">Google will ask you to choose an account again.</p>}
      </div>
    </main>
  );
}
