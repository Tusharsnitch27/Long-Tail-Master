"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-[13px] text-rose-900">
      <div className="font-semibold">Something went wrong loading this view</div>
      <div className="mt-1 font-mono text-[12px]">{error.message}{error.digest ? ` (ref ${error.digest})` : ""}</div>
      <button onClick={reset} className="mt-3 rounded-md bg-rose-700 px-3 py-1.5 text-white">Retry</button>
    </div>
  );
}
