import Link from "next/link";
export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <div className="text-[15px] font-semibold">Not found</div>
      <Link href="/" className="mt-2 inline-block text-[13px] text-brand-600 hover:underline">Back to overview</Link>
    </div>
  );
}
