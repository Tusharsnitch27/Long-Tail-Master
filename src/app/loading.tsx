import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-6 w-56" />
      <Skeleton className="mb-5 h-4 w-80" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[88px]" />)}
      </div>
      <Skeleton className="mb-4 h-64" />
      <Skeleton className="h-96" />
    </div>
  );
}
