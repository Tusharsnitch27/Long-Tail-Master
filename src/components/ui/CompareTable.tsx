import { Delta, Tip } from ".";

export function CompareTable({ cols, rows, colors }: { cols: string[]; colors?: string[]; rows: { label: string; tip?: string; values: string[]; deltas?: (number | null)[] }[] }) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
            <th className="py-2 pr-3 text-left font-semibold">Metric</th>
            {cols.map((c, i) => (
              <th key={c} className="px-3 py-2 text-right font-semibold">
                <span className="inline-flex items-center gap-1.5">{colors?.[i] && <span className="size-2 rounded-full" style={{ background: colors[i] }} />}{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-zinc-100 last:border-0">
              <td className="py-1.5 pr-3 text-zinc-600"><span className="inline-flex items-center gap-1">{r.label}{r.tip && <Tip text={r.tip} />}</span></td>
              {r.values.map((v, i) => (
                <td key={i} className="tabular px-3 py-1.5 text-right font-medium">
                  {v}{r.deltas && <div className="text-[11px] font-normal"><Delta v={r.deltas[i]} /></div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
